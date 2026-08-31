/** Pure TypeScript AST lowering for MongoG's implicitly awaited script language. */
import ts from 'typescript';
import type { ParsedScript } from './parse.js';
import { buildAutoAwaitProjection, isPromiseContinuation, type AutoAwaitProjection } from './auto-await-projection.js';

export interface AutoAwaitProgram {
  code: string;
  runtimeIdentifier: string;
  capturedStatementIndexes: number[];
  projection: AutoAwaitProjection;
}

interface Scope {
  temps: ts.Identifier[];
  sync: boolean;
  result?: ts.Identifier;
  state?: ts.Identifier;
}

type FunctionWithBody = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction |
  ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration;

export function lowerAutoAwait(source: string, parsed: ParsedScript): AutoAwaitProgram {
  const names = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(parsed.sourceFile);
  let nextId = 0;
  const fresh = (label: string) => {
    let name: string;
    do { name = `__mongog_${label}_${nextId++}`; } while (names.has(name));
    names.add(name);
    return ts.factory.createIdentifier(name);
  };
  const runtime = fresh('async');
  const capturedStatementIndexes: number[] = [];
  const f = ts.factory;
  const helper = (name: string, args: ts.Expression[] = []) => f.createCallExpression(f.createPropertyAccessExpression(runtime, name), undefined, args);
  const number = (value: number) => f.createNumericLiteral(value);
  const assign = (left: ts.Expression, right: ts.Expression) => f.createAssignment(left, right);
  const statement = (value: ts.Expression) => f.createExpressionStatement(value);
  const sequence = (...values: ts.Expression[]) => f.createParenthesizedExpression(f.createCommaListExpression(values));
  const undef = () => f.createVoidZero();
  const directives = (statements: readonly ts.Statement[]): ts.Statement[] => {
    const result: ts.Statement[] = [];
    for (const item of statements) {
      if (!ts.isExpressionStatement(item) || !ts.isStringLiteral(item.expression)) break;
      result.push(item);
    }
    return result;
  };
  const declare = (ids: ts.Identifier[]) => ids.length ? [f.createVariableStatement(undefined,
    f.createVariableDeclarationList(ids.map((id) => f.createVariableDeclaration(id)), ts.NodeFlags.Let))] : [];
  let scope: Scope = { temps: [], sync: false };
  const temp = () => { const id = fresh('value'); scope.temps.push(id); return id; };
  const wait = (value: ts.Expression): ts.Expression => {
    if (scope.sync) return helper('sync', [value]);
    const saved = temp();
    return sequence(assign(saved, value), f.createConditionalExpression(
      helper('isPromise', [saved]), undefined, f.createAwaitExpression(helper('wait', [saved])), undefined, saved,
    ));
  };

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isTypeNode(node)) return node;
      if (ts.isFunctionLike(node) && 'body' in node && node.body) return functionBody(node as FunctionWithBody);
      if (ts.isIdentifier(node)) return node; // Binding/property names are not value reads.
      if (ts.isShorthandPropertyAssignment(node)) return f.createPropertyAssignment(node.name, expr(node.name));
      if (ts.isVariableDeclaration(node)) return f.updateVariableDeclaration(node, ts.visitNode(node.name, visit) as ts.BindingName, node.exclamationToken, node.type, node.initializer && expr(node.initializer));
      if (ts.isPropertyAssignment(node)) return f.updatePropertyAssignment(node, ts.visitNode(node.name, visit) as ts.PropertyName, expr(node.initializer));
      if (ts.isBindingElement(node)) return f.updateBindingElement(node, node.dotDotDotToken, ts.visitNode(node.propertyName, visit) as ts.PropertyName | undefined, ts.visitNode(node.name, visit) as ts.BindingName, node.initializer && expr(node.initializer));
      if (ts.isReturnStatement(node)) {
        let value = node.expression ? expr(node.expression) : undef();
        if (scope.result) value = assign(scope.result, value);
        return f.updateReturnStatement(node, value);
      }
      if (ts.isThrowStatement(node)) return f.updateThrowStatement(node, expr(node.expression));
      if (ts.isExpressionStatement(node)) return f.updateExpressionStatement(node, expr(node.expression));
      if (ts.isIfStatement(node)) return f.updateIfStatement(node, expr(node.expression), ts.visitNode(node.thenStatement, visit) as ts.Statement, ts.visitNode(node.elseStatement, visit) as ts.Statement | undefined);
      if (ts.isWhileStatement(node)) return f.updateWhileStatement(node, expr(node.expression), loopBody(node.statement));
      if (ts.isDoStatement(node)) return f.updateDoStatement(node, loopBody(node.statement), expr(node.expression));
      if (ts.isForStatement(node)) return f.updateForStatement(node,
        node.initializer && (ts.isVariableDeclarationList(node.initializer) ? ts.visitNode(node.initializer, visit) as ts.VariableDeclarationList : expr(node.initializer)),
        node.condition && expr(node.condition), node.incrementor && expr(node.incrementor), loopBody(node.statement));
      if (ts.isForInStatement(node)) return f.updateForInStatement(node, node.initializer, expr(node.expression), loopBody(node.statement));
      if (ts.isLabeledStatement(node) && ts.isForOfStatement(node.statement)) return forOf(node.statement, node.label);
      if (ts.isForOfStatement(node)) return forOf(node);
      if (ts.isCatchClause(node)) {
        const binding = node.variableDeclaration?.name;
        const error = binding && ts.isIdentifier(binding) ? binding : fresh('caught');
        const body = ts.visitNode(node.block, visit) as ts.Block;
        return f.updateCatchClause(node, f.createVariableDeclaration(error), f.updateBlock(body, [
          statement(helper('checkCatch', [error])),
          ...(binding && !ts.isIdentifier(binding) ? [f.createVariableStatement(undefined, f.createVariableDeclarationList([f.createVariableDeclaration(binding, undefined, undefined, error)], ts.NodeFlags.Let))] : []),
          ...body.statements,
        ]));
      }
      if (ts.isPropertyDeclaration(node) && node.initializer) {
        const initializer = syncExpression(node.initializer);
        return f.updatePropertyDeclaration(node, node.modifiers, node.name, node.questionToken ?? node.exclamationToken, node.type, initializer);
      }
      if (ts.isExpression(node)) return expr(node);
      return ts.visitEachChild(node, visit, context);
    };
    const loopBody = (body: ts.Statement) => f.createBlock([
      statement(helper('checkpoint')),
      ts.visitNode(body, visit) as ts.Statement,
    ], true);
    const forOf = (node: ts.ForOfStatement, label?: ts.Identifier): ts.Statement => {
      const iterator = fresh('iterator'); const step = fresh('step');
      const value = wait(f.createPropertyAccessExpression(step, 'value'));
      const binding = ts.isVariableDeclarationList(node.initializer)
        ? f.createVariableStatement(undefined, f.updateVariableDeclarationList(node.initializer, [
          f.updateVariableDeclaration(node.initializer.declarations[0]!, node.initializer.declarations[0]!.name, undefined, undefined, value),
        ]))
        : statement(assign(lvalue(node.initializer), value));
      const loop = f.createForStatement(undefined, undefined, undefined, f.createBlock([
        statement(helper('checkpoint')),
        statement(assign(step, wait(f.createCallExpression(f.createPropertyAccessExpression(iterator, 'next'), undefined, [])))),
        f.createIfStatement(f.createPropertyAccessExpression(step, 'done'), f.createBreakStatement()),
        binding,
        ts.visitNode(node.statement, visit) as ts.Statement,
      ], true));
      return f.createBlock([
        f.createVariableStatement(undefined, f.createVariableDeclarationList([
          f.createVariableDeclaration(iterator, undefined, undefined, helper('iterator', [expr(node.expression)])),
        ], ts.NodeFlags.Const)),
        ...declare([step]),
        f.createTryStatement(f.createBlock([label ? f.createLabeledStatement(label, loop) : loop], true), undefined,
          f.createBlock([statement(wait(f.createCallExpression(f.createPropertyAccessExpression(iterator, 'close'), undefined, [])))], true)),
      ], true);
    };
    const functionBody = (node: FunctionWithBody): FunctionWithBody => {
      const name = 'name' in node && node.name && ts.isComputedPropertyName(node.name)
        ? f.updateComputedPropertyName(node.name, expr(node.name.expression)) : undefined;
      const previous = scope;
      const explicitAsync = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
      const sync = ts.isConstructorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
        (!explicitAsync && 'asteriskToken' in node && !!node.asteriskToken);
      scope = { temps: [], sync };
      if (!sync && !explicitAsync) { scope.result = fresh('result'); scope.state = fresh('state'); }
      const body = ts.isBlock(node.body!)
        ? ts.visitEachChild(node.body!, visit, context) as ts.Block
        : f.createBlock([ts.visitNode(f.createReturnStatement(node.body as ts.Expression), visit) as ts.Statement], true);
      let loweredBody: ts.Block;
      if (scope.state && scope.result) {
        const { state, result } = scope;
        const error = fresh('error'); const promise = fresh('promise');
        const inner = f.createArrowFunction([f.createModifier(ts.SyntaxKind.AsyncKeyword)], undefined, [], undefined, undefined,
          f.createBlock([
            ...declare(scope.temps),
            f.createTryStatement(f.createBlock([
              statement(helper('checkpoint')), ...body.statements,
            ], true), f.createCatchClause(f.createVariableDeclaration(error), f.createBlock([
              f.createIfStatement(f.createBinaryExpression(state, ts.SyntaxKind.EqualsEqualsEqualsToken, number(0)),
                f.createBlock([statement(assign(state, number(2))), statement(assign(result, error))]), f.createThrowStatement(error)),
            ], true)), f.createBlock([
              f.createIfStatement(f.createBinaryExpression(state, ts.SyntaxKind.ExclamationEqualsEqualsToken, number(2)), statement(assign(state, number(1)))),
            ], true)),
          ], true));
        loweredBody = f.createBlock([
          ...declare([state, result]), statement(assign(state, number(0))),
          f.createVariableStatement(undefined, f.createVariableDeclarationList([f.createVariableDeclaration(promise, undefined, undefined, f.createCallExpression(f.createParenthesizedExpression(inner), undefined, []))], ts.NodeFlags.Const)),
          f.createIfStatement(f.createBinaryExpression(state, ts.SyntaxKind.EqualsEqualsEqualsToken, number(1)), f.createReturnStatement(result)),
          f.createIfStatement(f.createBinaryExpression(state, ts.SyntaxKind.EqualsEqualsEqualsToken, number(2)), f.createThrowStatement(result)),
          statement(assign(state, number(3))),
          ...(ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ? [
            f.createIfStatement(f.createMetaProperty(ts.SyntaxKind.NewKeyword, f.createIdentifier('target')), f.createReturnStatement(helper('sync', [promise]))),
          ] : []),
          f.createReturnStatement(helper('track', [promise])),
        ], true);
      } else {
        loweredBody = f.updateBlock(body, [...declare(scope.temps), statement(helper('checkpoint')), ...body.statements]);
      }
      if (ts.isBlock(node.body!)) loweredBody = f.updateBlock(loweredBody, [...directives((node.body as ts.Block).statements), ...loweredBody.statements]);
      // Parameter evaluation is an always-synchronous JS context.
      const parameters = node.parameters.map((parameter) => f.updateParameterDeclaration(parameter, parameter.modifiers,
        parameter.dotDotDotToken, syncBinding(parameter.name), parameter.questionToken, parameter.type, parameter.initializer && syncExpression(parameter.initializer)));
      scope = previous;
      if (ts.isFunctionDeclaration(node)) return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, node.type, loweredBody);
      if (ts.isFunctionExpression(node)) return f.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, parameters, node.type, loweredBody);
      if (ts.isArrowFunction(node)) return f.updateArrowFunction(node, node.modifiers, node.typeParameters, parameters, node.type, node.equalsGreaterThanToken, loweredBody);
      if (ts.isMethodDeclaration(node)) return f.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, name ?? node.name, node.questionToken, node.typeParameters, parameters, node.type, loweredBody);
      if (ts.isGetAccessorDeclaration(node)) return f.updateGetAccessorDeclaration(node, node.modifiers, name ?? node.name, parameters, node.type, loweredBody);
      if (ts.isSetAccessorDeclaration(node)) return f.updateSetAccessorDeclaration(node, node.modifiers, name ?? node.name, parameters, loweredBody);
      return f.updateConstructorDeclaration(node, node.modifiers, parameters, loweredBody);
    };
    const syncExpression = (node: ts.Expression): ts.Expression => {
      const previous = scope;
      scope = { temps: [], sync: true };
      const value = expr(node);
      const body = f.createBlock([...declare(scope.temps), f.createReturnStatement(value)], true);
      scope = previous;
      return f.createCallExpression(f.createParenthesizedExpression(f.createArrowFunction(undefined, undefined, [], undefined, undefined, body)), undefined, []);
    };
    const syncBinding = (node: ts.BindingName): ts.BindingName => {
      if (ts.isIdentifier(node)) return node;
      const elements = node.elements.map(element => ts.isOmittedExpression(element) ? element : f.updateBindingElement(element,
        element.dotDotDotToken, element.propertyName && ts.isComputedPropertyName(element.propertyName)
          ? f.updateComputedPropertyName(element.propertyName, syncExpression(element.propertyName.expression)) : element.propertyName,
        syncBinding(element.name), element.initializer && syncExpression(element.initializer)));
      return ts.isObjectBindingPattern(node) ? f.updateObjectBindingPattern(node, elements as ts.BindingElement[]) : f.updateArrayBindingPattern(node, elements);
    };
    const lvalue = (node: ts.Expression): ts.Expression => {
      if (ts.isPropertyAccessExpression(node)) return f.updatePropertyAccessExpression(node, node.expression.kind === ts.SyntaxKind.SuperKeyword ? node.expression : expr(node.expression), node.name);
      if (ts.isElementAccessExpression(node)) return f.updateElementAccessExpression(node, expr(node.expression), expr(node.argumentExpression));
      if (ts.isParenthesizedExpression(node)) return f.updateParenthesizedExpression(node, lvalue(node.expression));
      if (ts.isArrayLiteralExpression(node)) return f.updateArrayLiteralExpression(node, node.elements.map(lvalue));
      if (ts.isSpreadElement(node)) return f.updateSpreadElement(node, lvalue(node.expression));
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) return f.updateBinaryExpression(node, lvalue(node.left), node.operatorToken, expr(node.right));
      if (ts.isObjectLiteralExpression(node)) return f.updateObjectLiteralExpression(node, node.properties.map(property => {
        if (ts.isPropertyAssignment(property)) return f.updatePropertyAssignment(property, ts.visitNode(property.name, visit) as ts.PropertyName, lvalue(property.initializer));
        if (ts.isShorthandPropertyAssignment(property)) return f.updateShorthandPropertyAssignment(property, property.name, property.objectAssignmentInitializer && expr(property.objectAssignmentInitializer));
        if (ts.isSpreadAssignment(property)) return f.updateSpreadAssignment(property, lvalue(property.expression));
        return property;
      }));
      return node;
    };
    const parallelArguments = (node: ts.Expression): ts.Expression => {
      if (ts.isArrayLiteralExpression(node)) return f.updateArrayLiteralExpression(node, node.elements.map((element) => {
        if (ts.isOmittedExpression(element)) return element;
        if (ts.isSpreadElement(element)) return f.updateSpreadElement(element, expr(element.expression));
        // Each job gets its own scope/temporaries and starts without awaiting its sibling.
        const arrow = f.createArrowFunction([f.createModifier(ts.SyntaxKind.AsyncKeyword)], undefined, [], undefined, undefined, element);
        return f.createCallExpression(f.createParenthesizedExpression(functionBody(arrow) as ts.ArrowFunction), undefined, []);
      }));
      if (ts.isCallExpression(node)) return call(node, true);
      return expr(node);
    };
    const isCombinator = (node: ts.CallExpression) => ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Promise' &&
      ['all', 'allSettled', 'race', 'any'].includes(node.expression.name.text);
    const call = (node: ts.CallExpression, parallelArray = false): ts.Expression => {
      if (node.expression.kind === ts.SyntaxKind.SuperKeyword) return f.updateCallExpression(node, node.expression, node.typeArguments, node.arguments.map((arg) => expr(arg)));
      const method = node.expression;
      const promiseChain = isPromiseContinuation(method);
      let receiver: ts.Expression = undef(); let callee: ts.Expression;
      if (ts.isPropertyAccessExpression(method) || ts.isElementAccessExpression(method)) {
        if (method.expression.kind === ts.SyntaxKind.SuperKeyword) {
          receiver = f.createThis(); callee = method;
        } else {
          const target = temp();
          receiver = assign(target, expr(method.expression, !promiseChain));
          callee = ts.isPropertyAccessExpression(method) ? f.createPropertyAccessExpression(target, method.name) : f.createElementAccessExpression(target, expr(method.argumentExpression));
        }
      } else callee = expr(method, false);
      const combinator = isCombinator(node);
      const savedCallee = combinator ? temp() : undefined;
      const target = ts.isBinaryExpression(receiver) ? receiver.left : receiver;
      const args = node.arguments.map((arg, index) => combinator && index === 0
        ? f.createConditionalExpression(helper('isCombinator', [target, savedCallee!]), undefined, parallelArguments(arg), undefined, expr(arg))
        : expr(arg));
      if (savedCallee) callee = assign(savedCallee, callee);
      return helper('invoke', [receiver, callee, f.createArrayLiteralExpression(args), parallelArray ? f.createTrue() : f.createFalse()]);
    };
    const optionalChain = (node: ts.Expression, shouldWait = true): ts.Expression => {
      type Link = ts.PropertyAccessExpression | ts.ElementAccessExpression | ts.CallExpression;
      const links: Link[] = [];
      let base = node;
      while (ts.isPropertyAccessChain(base) || ts.isElementAccessChain(base) || ts.isCallChain(base)) {
        links.unshift(base); base = base.expression;
      }
      const build = (index: number, current: ts.Expression, receiver: ts.Expression = undef()): ts.Expression => {
        if (index === links.length) return shouldWait ? wait(current) : current;
        const link = links[index]!;
        const saved = temp();
        const proceed = () => {
          if (ts.isCallExpression(link)) {
            const args = link.arguments.map((arg, argumentIndex) => isCombinator(link) && argumentIndex === 0
              ? f.createConditionalExpression(helper('isCombinator', [receiver, saved]), undefined, parallelArguments(arg), undefined, expr(arg))
              : expr(arg));
            const called = helper('invoke', [receiver, saved, f.createArrayLiteralExpression(args)]);
            const next = links[index + 1];
            const keepPromise = next ? isPromiseContinuation(next) : !shouldWait;
            return build(index + 1, keepPromise ? called : wait(called));
          }
          const access = ts.isPropertyAccessExpression(link) ? f.createPropertyAccessExpression(saved, link.name) : f.createElementAccessExpression(saved, expr(link.argumentExpression));
          return build(index + 1, access, saved);
        };
        const continuation = isPromiseContinuation(link) && ts.isCallExpression(links[index + 1] ?? node);
        return sequence(assign(saved, continuation ? current : wait(current)), link.questionDotToken
          ? f.createConditionalExpression(f.createBinaryExpression(saved, ts.SyntaxKind.EqualsEqualsToken, f.createNull()), undefined, undef(), undefined, proceed())
          : proceed());
      };
      return build(0, expr(base, !isPromiseContinuation(links[0]!)));
    };
    const expr = (node: ts.Expression, shouldWait = true): ts.Expression => {
      if (ts.isParenthesizedExpression(node)) return f.updateParenthesizedExpression(node, expr(node.expression, shouldWait));
      if (ts.isAsExpression(node)) return f.updateAsExpression(node, expr(node.expression, shouldWait), node.type);
      if (ts.isNonNullExpression(node)) return f.updateNonNullExpression(node, expr(node.expression, shouldWait));
      if (ts.isSatisfiesExpression(node)) return f.updateSatisfiesExpression(node, expr(node.expression, shouldWait), node.type);
      if (ts.isTypeAssertionExpression(node)) return f.updateTypeAssertion(node, node.type, expr(node.expression, shouldWait));
      if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return functionBody(node) as ts.Expression;
      if (ts.isClassExpression(node)) return ts.visitEachChild(node, visit, context);
      if (ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node) || ts.isCallChain(node)) return optionalChain(node, shouldWait);
      if (ts.isAwaitExpression(node)) return f.createAwaitExpression(helper('wait', [expr(node.expression, false)]));
      if (ts.isCallExpression(node)) { const value = call(node); return shouldWait ? wait(value) : value; }
      if (ts.isNewExpression(node)) {
        const value = helper('construct', [expr(node.expression, false), f.createArrayLiteralExpression(node.arguments?.map((arg) => expr(arg)) ?? [])]);
        return shouldWait ? wait(value) : value;
      }
      if (ts.isTaggedTemplateExpression(node)) {
        const value = f.updateTaggedTemplateExpression(node, lvalue(node.tag), node.typeArguments, ts.visitNode(node.template, visit) as ts.TemplateLiteral);
        return shouldWait ? wait(value) : value;
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const value = lvalue(node); return shouldWait ? wait(value) : value;
      }
      if (ts.isBinaryExpression(node)) {
        const isAssignment = node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        return f.updateBinaryExpression(node, isAssignment ? lvalue(node.left) : expr(node.left), node.operatorToken, expr(node.right));
      }
      if (ts.isPrefixUnaryExpression(node)) return f.updatePrefixUnaryExpression(node,
        node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken ? lvalue(node.operand) : expr(node.operand));
      if (ts.isPostfixUnaryExpression(node)) return f.updatePostfixUnaryExpression(node, lvalue(node.operand));
      if (ts.isDeleteExpression(node)) return f.updateDeleteExpression(node, lvalue(node.expression));
      if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression)) return node;
      if (ts.isObjectLiteralExpression(node)) return ts.visitEachChild(node, visit, context);
      if (ts.isIdentifier(node)) return shouldWait ? wait(node) : node;
      if (ts.isMetaProperty(node) || node.kind === ts.SyntaxKind.SuperKeyword) return node;
      return ts.visitEachChild(node, (child) => ts.isExpression(child) ? expr(child) : visit(child), context);
    };
    return (file) => {
      const statements: ts.Statement[] = [];
      for (const [index, original] of file.statements.entries()) {
        if (ts.isExpressionStatement(original)) {
          capturedStatementIndexes.push(index);
          const expression = expr(original.expression);
          const thunk = f.createArrowFunction([f.createModifier(ts.SyntaxKind.AsyncKeyword)], undefined, [], undefined, undefined, f.createParenthesizedExpression(expression));
          statements.push(statement(f.createAwaitExpression(f.createCallExpression(f.createIdentifier('__mongogCapture'), undefined, [number(index), thunk]))));
        } else {
          statements.push(statement(f.createCallExpression(f.createIdentifier('__mongogMark'), undefined, [number(index)])));
          const transformed = ts.visitNode(original, visit) as ts.Statement;
          statements.push(transformed);
        }
      }
      const wrapper = f.createArrowFunction([f.createModifier(ts.SyntaxKind.AsyncKeyword)], undefined, [], undefined, undefined,
        f.createBlock([...directives(file.statements), ...declare(scope.temps), ...statements], true));
      return f.updateSourceFile(file, [statement(f.createCallExpression(f.createParenthesizedExpression(wrapper), undefined, []))]);
    };
  };
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, esModuleInterop: true },
    transformers: { before: [transformer] },
  });
  return { code: output.outputText, runtimeIdentifier: runtime.text, capturedStatementIndexes, projection: buildAutoAwaitProjection(source) };
}
