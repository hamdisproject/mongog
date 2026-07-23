import F, { join as _n } from "node:path";
import { BrowserWindow as U, shell as vn, screen as yn, ipcMain as wn, utilityProcess as En, app as j, safeStorage as te } from "electron";
import { fileURLToPath as Ct } from "node:url";
import { EventEmitter as Pt } from "node:events";
import { randomUUID as Oe } from "node:crypto";
import { statSync as bn } from "node:fs";
import Xe from "better-sqlite3";
const He = F.dirname(Ct(import.meta.url));
function Zt() {
  const e = [];
  return e.push("file://"), e;
}
function Ke(e) {
  const r = e?.windowState?.bounds, o = r && Tn(r) ? r : { width: 1440, height: 900 }, i = new U({
    ...o,
    minWidth: 900,
    minHeight: 600,
    title: "MongoG",
    backgroundColor: "#1e1e1e",
    show: !1,
    webPreferences: {
      preload: F.join(He, "preload.cjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      sandbox: !0,
      webSecurity: !0,
      allowRunningInsecureContent: !1,
      spellcheck: !1
    }
  });
  return e?.windowState?.maximized && i.maximize(), i.once("ready-to-show", () => i.show()), i.webContents.on("will-navigate", (s, c) => {
    Zt().some((a) => c.startsWith(a)) || s.preventDefault();
  }), i.webContents.setWindowOpenHandler(({ url: s }) => (s.startsWith("https://") && vn.openExternal(s), { action: "deny" })), i.loadFile(F.join(He, "../renderer/main_window/index.html")), i;
}
function Tn(e) {
  return yn.getAllDisplays().some((t) => {
    const { x: n, y: r, width: o, height: i } = t.workArea;
    return e.x >= n && e.y >= r && e.x + e.width <= n + o && e.y + e.height <= r + i;
  });
}
var qe;
function u(e, t, n) {
  function r(c, a) {
    if (c._zod || Object.defineProperty(c, "_zod", {
      value: {
        def: a,
        constr: s,
        traits: /* @__PURE__ */ new Set()
      },
      enumerable: !1
    }), c._zod.traits.has(e))
      return;
    c._zod.traits.add(e), t(c, a);
    const l = s.prototype, d = Object.keys(l);
    for (let _ = 0; _ < d.length; _++) {
      const m = d[_];
      m in c || (c[m] = l[m].bind(c));
    }
  }
  const o = n?.Parent ?? Object;
  class i extends o {
  }
  Object.defineProperty(i, "name", { value: e });
  function s(c) {
    var a;
    const l = n?.Parent ? new i() : this;
    r(l, c), (a = l._zod).deferred ?? (a.deferred = []);
    for (const d of l._zod.deferred)
      d();
    return l;
  }
  return Object.defineProperty(s, "init", { value: r }), Object.defineProperty(s, Symbol.hasInstance, {
    value: (c) => n?.Parent && c instanceof n.Parent ? !0 : c?._zod?.traits?.has(e)
  }), Object.defineProperty(s, "name", { value: e }), s;
}
class Y extends Error {
  constructor() {
    super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
  }
}
class Lt extends Error {
  constructor(t) {
    super(`Encountered unidirectional transform during encode: ${t}`), this.name = "ZodEncodeError";
  }
}
(qe = globalThis).__zod_globalConfig ?? (qe.__zod_globalConfig = {});
const Ze = globalThis.__zod_globalConfig;
function B(e) {
  return Ze;
}
function Dt(e) {
  const t = Object.values(e).filter((r) => typeof r == "number");
  return Object.entries(e).filter(([r, o]) => t.indexOf(+r) === -1).map(([r, o]) => o);
}
function Ie(e, t) {
  return typeof t == "bigint" ? t.toString() : t;
}
function Le(e) {
  return {
    get value() {
      {
        const t = e();
        return Object.defineProperty(this, "value", { value: t }), t;
      }
    }
  };
}
function De(e) {
  return e == null;
}
function xe(e) {
  const t = e.startsWith("^") ? 1 : 0, n = e.endsWith("$") ? e.length - 1 : e.length;
  return e.slice(t, n);
}
function Sn(e, t) {
  const n = e / t, r = Math.round(n), o = Number.EPSILON * Math.max(Math.abs(n), 1);
  return Math.abs(n - r) < o ? 0 : n - r;
}
const Ye = /* @__PURE__ */ Symbol("evaluating");
function b(e, t, n) {
  let r;
  Object.defineProperty(e, t, {
    get() {
      if (r !== Ye)
        return r === void 0 && (r = Ye, r = n()), r;
    },
    set(o) {
      Object.defineProperty(e, t, {
        value: o
        // configurable: true,
      });
    },
    configurable: !0
  });
}
function H(e, t, n) {
  Object.defineProperty(e, t, {
    value: n,
    writable: !0,
    enumerable: !0,
    configurable: !0
  });
}
function G(...e) {
  const t = {};
  for (const n of e) {
    const r = Object.getOwnPropertyDescriptors(n);
    Object.assign(t, r);
  }
  return Object.defineProperties({}, t);
}
function Qe(e) {
  return JSON.stringify(e);
}
function kn(e) {
  return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const xt = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {
};
function ge(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const On = /* @__PURE__ */ Le(() => {
  if (Ze.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare"))
    return !1;
  try {
    const e = Function;
    return new e(""), !0;
  } catch {
    return !1;
  }
});
function ie(e) {
  if (ge(e) === !1)
    return !1;
  const t = e.constructor;
  if (t === void 0 || typeof t != "function")
    return !0;
  const n = t.prototype;
  return !(ge(n) === !1 || Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") === !1);
}
function Ut(e) {
  return ie(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
const zn = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function we(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function W(e, t, n) {
  const r = new e._zod.constr(t ?? e._zod.def);
  return (!t || n?.parent) && (r._zod.parent = e), r;
}
function f(e) {
  const t = e;
  if (!t)
    return {};
  if (typeof t == "string")
    return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return delete t.message, typeof t.error == "string" ? { ...t, error: () => t.error } : t;
}
function Nn(e) {
  return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
const In = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function $n(e, t) {
  const n = e._zod.def, r = n.checks;
  if (r && r.length > 0)
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  const i = G(e._zod.def, {
    get shape() {
      const s = {};
      for (const c in t) {
        if (!(c in n.shape))
          throw new Error(`Unrecognized key: "${c}"`);
        t[c] && (s[c] = n.shape[c]);
      }
      return H(this, "shape", s), s;
    },
    checks: []
  });
  return W(e, i);
}
function Rn(e, t) {
  const n = e._zod.def, r = n.checks;
  if (r && r.length > 0)
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  const i = G(e._zod.def, {
    get shape() {
      const s = { ...e._zod.def.shape };
      for (const c in t) {
        if (!(c in n.shape))
          throw new Error(`Unrecognized key: "${c}"`);
        t[c] && delete s[c];
      }
      return H(this, "shape", s), s;
    },
    checks: []
  });
  return W(e, i);
}
function An(e, t) {
  if (!ie(t))
    throw new Error("Invalid input to extend: expected a plain object");
  const n = e._zod.def.checks;
  if (n && n.length > 0) {
    const i = e._zod.def.shape;
    for (const s in t)
      if (Object.getOwnPropertyDescriptor(i, s) !== void 0)
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
  }
  const o = G(e._zod.def, {
    get shape() {
      const i = { ...e._zod.def.shape, ...t };
      return H(this, "shape", i), i;
    }
  });
  return W(e, o);
}
function Cn(e, t) {
  if (!ie(t))
    throw new Error("Invalid input to safeExtend: expected a plain object");
  const n = G(e._zod.def, {
    get shape() {
      const r = { ...e._zod.def.shape, ...t };
      return H(this, "shape", r), r;
    }
  });
  return W(e, n);
}
function Pn(e, t) {
  if (e._zod.def.checks?.length)
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  const n = G(e._zod.def, {
    get shape() {
      const r = { ...e._zod.def.shape, ...t._zod.def.shape };
      return H(this, "shape", r), r;
    },
    get catchall() {
      return t._zod.def.catchall;
    },
    checks: t._zod.def.checks ?? []
  });
  return W(e, n);
}
function Zn(e, t, n) {
  const o = t._zod.def.checks;
  if (o && o.length > 0)
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  const s = G(t._zod.def, {
    get shape() {
      const c = t._zod.def.shape, a = { ...c };
      if (n)
        for (const l in n) {
          if (!(l in c))
            throw new Error(`Unrecognized key: "${l}"`);
          n[l] && (a[l] = e ? new e({
            type: "optional",
            innerType: c[l]
          }) : c[l]);
        }
      else
        for (const l in c)
          a[l] = e ? new e({
            type: "optional",
            innerType: c[l]
          }) : c[l];
      return H(this, "shape", a), a;
    },
    checks: []
  });
  return W(t, s);
}
function Ln(e, t, n) {
  const r = G(t._zod.def, {
    get shape() {
      const o = t._zod.def.shape, i = { ...o };
      if (n)
        for (const s in n) {
          if (!(s in i))
            throw new Error(`Unrecognized key: "${s}"`);
          n[s] && (i[s] = new e({
            type: "nonoptional",
            innerType: o[s]
          }));
        }
      else
        for (const s in o)
          i[s] = new e({
            type: "nonoptional",
            innerType: o[s]
          });
      return H(this, "shape", i), i;
    }
  });
  return W(t, r);
}
function q(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue !== !0)
      return !0;
  return !1;
}
function Dn(e, t = 0) {
  if (e.aborted === !0)
    return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue === !1)
      return !0;
  return !1;
}
function Mt(e, t) {
  return t.map((n) => {
    var r;
    return (r = n).path ?? (r.path = []), n.path.unshift(e), n;
  });
}
function le(e) {
  return typeof e == "string" ? e : e?.message;
}
function V(e, t, n) {
  const r = e.message ? e.message : le(e.inst?._zod.def?.error?.(e)) ?? le(t?.error?.(e)) ?? le(n.customError?.(e)) ?? le(n.localeError?.(e)) ?? "Invalid input", { inst: o, continue: i, input: s, ...c } = e;
  return c.path ?? (c.path = []), c.message = r, t?.reportInput && (c.input = s), c;
}
function Ue(e) {
  return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function ce(...e) {
  const [t, n, r] = e;
  return typeof t == "string" ? {
    message: t,
    code: "custom",
    input: n,
    inst: r
  } : { ...t };
}
const Ft = (e, t) => {
  e.name = "$ZodError", Object.defineProperty(e, "_zod", {
    value: e._zod,
    enumerable: !1
  }), Object.defineProperty(e, "issues", {
    value: t,
    enumerable: !1
  }), e.message = JSON.stringify(t, Ie, 2), Object.defineProperty(e, "toString", {
    value: () => e.message,
    enumerable: !1
  });
}, jt = u("$ZodError", Ft), Gt = u("$ZodError", Ft, { Parent: Error });
function xn(e, t = (n) => n.message) {
  const n = {}, r = [];
  for (const o of e.issues)
    o.path.length > 0 ? (n[o.path[0]] = n[o.path[0]] || [], n[o.path[0]].push(t(o))) : r.push(t(o));
  return { formErrors: r, fieldErrors: n };
}
function Un(e, t = (n) => n.message) {
  const n = { _errors: [] }, r = (o, i = []) => {
    for (const s of o.issues)
      if (s.code === "invalid_union" && s.errors.length)
        s.errors.map((c) => r({ issues: c }, [...i, ...s.path]));
      else if (s.code === "invalid_key")
        r({ issues: s.issues }, [...i, ...s.path]);
      else if (s.code === "invalid_element")
        r({ issues: s.issues }, [...i, ...s.path]);
      else {
        const c = [...i, ...s.path];
        if (c.length === 0)
          n._errors.push(t(s));
        else {
          let a = n, l = 0;
          for (; l < c.length; ) {
            const d = c[l];
            l === c.length - 1 ? (a[d] = a[d] || { _errors: [] }, a[d]._errors.push(t(s))) : a[d] = a[d] || { _errors: [] }, a = a[d], l++;
          }
        }
      }
  };
  return r(e), n;
}
const Me = (e) => (t, n, r, o) => {
  const i = r ? { ...r, async: !1 } : { async: !1 }, s = t._zod.run({ value: n, issues: [] }, i);
  if (s instanceof Promise)
    throw new Y();
  if (s.issues.length) {
    const c = new (o?.Err ?? e)(s.issues.map((a) => V(a, i, B())));
    throw xt(c, o?.callee), c;
  }
  return s.value;
}, Fe = (e) => async (t, n, r, o) => {
  const i = r ? { ...r, async: !0 } : { async: !0 };
  let s = t._zod.run({ value: n, issues: [] }, i);
  if (s instanceof Promise && (s = await s), s.issues.length) {
    const c = new (o?.Err ?? e)(s.issues.map((a) => V(a, i, B())));
    throw xt(c, o?.callee), c;
  }
  return s.value;
}, Ee = (e) => (t, n, r) => {
  const o = r ? { ...r, async: !1 } : { async: !1 }, i = t._zod.run({ value: n, issues: [] }, o);
  if (i instanceof Promise)
    throw new Y();
  return i.issues.length ? {
    success: !1,
    error: new (e ?? jt)(i.issues.map((s) => V(s, o, B())))
  } : { success: !0, data: i.value };
}, Mn = /* @__PURE__ */ Ee(Gt), be = (e) => async (t, n, r) => {
  const o = r ? { ...r, async: !0 } : { async: !0 };
  let i = t._zod.run({ value: n, issues: [] }, o);
  return i instanceof Promise && (i = await i), i.issues.length ? {
    success: !1,
    error: new e(i.issues.map((s) => V(s, o, B())))
  } : { success: !0, data: i.value };
}, Fn = /* @__PURE__ */ be(Gt), jn = (e) => (t, n, r) => {
  const o = r ? { ...r, direction: "backward" } : { direction: "backward" };
  return Me(e)(t, n, o);
}, Gn = (e) => (t, n, r) => Me(e)(t, n, r), Wn = (e) => async (t, n, r) => {
  const o = r ? { ...r, direction: "backward" } : { direction: "backward" };
  return Fe(e)(t, n, o);
}, Jn = (e) => async (t, n, r) => Fe(e)(t, n, r), Bn = (e) => (t, n, r) => {
  const o = r ? { ...r, direction: "backward" } : { direction: "backward" };
  return Ee(e)(t, n, o);
}, Vn = (e) => (t, n, r) => Ee(e)(t, n, r), Xn = (e) => async (t, n, r) => {
  const o = r ? { ...r, direction: "backward" } : { direction: "backward" };
  return be(e)(t, n, o);
}, Hn = (e) => async (t, n, r) => be(e)(t, n, r), Kn = /^[cC][0-9a-z]{6,}$/, qn = /^[0-9a-z]+$/, Yn = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, Qn = /^[0-9a-vA-V]{20}$/, er = /^[A-Za-z0-9]{27}$/, tr = /^[a-zA-Z0-9_-]{21}$/, nr = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, rr = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, et = (e) => e ? new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, or = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, sr = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function ir() {
  return new RegExp(sr, "u");
}
const cr = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, ar = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, ur = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, lr = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, dr = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, Wt = /^[A-Za-z0-9_-]*$/, pr = /^https?$/, fr = /^\+[1-9]\d{6,14}$/, Jt = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", hr = /* @__PURE__ */ new RegExp(`^${Jt}$`);
function Bt(e) {
  const t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
  return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function mr(e) {
  return new RegExp(`^${Bt(e)}$`);
}
function gr(e) {
  const t = Bt({ precision: e.precision }), n = ["Z"];
  e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
  const r = `${t}(?:${n.join("|")})`;
  return new RegExp(`^${Jt}T(?:${r})$`);
}
const _r = (e) => {
  const t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
  return new RegExp(`^${t}$`);
}, vr = /^-?\d+$/, yr = /^-?\d+(?:\.\d+)?$/, wr = /^(?:true|false)$/i, Er = /^[^A-Z]*$/, br = /^[^a-z]*$/, C = /* @__PURE__ */ u("$ZodCheck", (e, t) => {
  var n;
  e._zod ?? (e._zod = {}), e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Vt = {
  number: "number",
  bigint: "bigint",
  object: "date"
}, Xt = /* @__PURE__ */ u("$ZodCheckLessThan", (e, t) => {
  C.init(e, t);
  const n = Vt[typeof t.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, i = (t.inclusive ? o.maximum : o.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    t.value < i && (t.inclusive ? o.maximum = t.value : o.exclusiveMaximum = t.value);
  }), e._zod.check = (r) => {
    (t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
      origin: n,
      code: "too_big",
      maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: r.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), Ht = /* @__PURE__ */ u("$ZodCheckGreaterThan", (e, t) => {
  C.init(e, t);
  const n = Vt[typeof t.value];
  e._zod.onattach.push((r) => {
    const o = r._zod.bag, i = (t.inclusive ? o.minimum : o.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    t.value > i && (t.inclusive ? o.minimum = t.value : o.exclusiveMinimum = t.value);
  }), e._zod.check = (r) => {
    (t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
      origin: n,
      code: "too_small",
      minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
      input: r.value,
      inclusive: t.inclusive,
      inst: e,
      continue: !t.abort
    });
  };
}), Tr = /* @__PURE__ */ u("$ZodCheckMultipleOf", (e, t) => {
  C.init(e, t), e._zod.onattach.push((n) => {
    var r;
    (r = n._zod.bag).multipleOf ?? (r.multipleOf = t.value);
  }), e._zod.check = (n) => {
    if (typeof n.value != typeof t.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    (typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : Sn(n.value, t.value) === 0) || n.issues.push({
      origin: typeof n.value,
      code: "not_multiple_of",
      divisor: t.value,
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Sr = /* @__PURE__ */ u("$ZodCheckNumberFormat", (e, t) => {
  C.init(e, t), t.format = t.format || "float64";
  const n = t.format?.includes("int"), r = n ? "int" : "number", [o, i] = In[t.format];
  e._zod.onattach.push((s) => {
    const c = s._zod.bag;
    c.format = t.format, c.minimum = o, c.maximum = i, n && (c.pattern = vr);
  }), e._zod.check = (s) => {
    const c = s.value;
    if (n) {
      if (!Number.isInteger(c)) {
        s.issues.push({
          expected: r,
          format: t.format,
          code: "invalid_type",
          continue: !1,
          input: c,
          inst: e
        });
        return;
      }
      if (!Number.isSafeInteger(c)) {
        c > 0 ? s.issues.push({
          input: c,
          code: "too_big",
          maximum: Number.MAX_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        }) : s.issues.push({
          input: c,
          code: "too_small",
          minimum: Number.MIN_SAFE_INTEGER,
          note: "Integers must be within the safe integer range.",
          inst: e,
          origin: r,
          inclusive: !0,
          continue: !t.abort
        });
        return;
      }
    }
    c < o && s.issues.push({
      origin: "number",
      input: c,
      code: "too_small",
      minimum: o,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    }), c > i && s.issues.push({
      origin: "number",
      input: c,
      code: "too_big",
      maximum: i,
      inclusive: !0,
      inst: e,
      continue: !t.abort
    });
  };
}), kr = /* @__PURE__ */ u("$ZodCheckMaxLength", (e, t) => {
  var n;
  C.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !De(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    t.maximum < o && (r._zod.bag.maximum = t.maximum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length <= t.maximum)
      return;
    const s = Ue(o);
    r.issues.push({
      origin: s,
      code: "too_big",
      maximum: t.maximum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), Or = /* @__PURE__ */ u("$ZodCheckMinLength", (e, t) => {
  var n;
  C.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !De(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    t.minimum > o && (r._zod.bag.minimum = t.minimum);
  }), e._zod.check = (r) => {
    const o = r.value;
    if (o.length >= t.minimum)
      return;
    const s = Ue(o);
    r.issues.push({
      origin: s,
      code: "too_small",
      minimum: t.minimum,
      inclusive: !0,
      input: o,
      inst: e,
      continue: !t.abort
    });
  };
}), zr = /* @__PURE__ */ u("$ZodCheckLengthEquals", (e, t) => {
  var n;
  C.init(e, t), (n = e._zod.def).when ?? (n.when = (r) => {
    const o = r.value;
    return !De(o) && o.length !== void 0;
  }), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.minimum = t.length, o.maximum = t.length, o.length = t.length;
  }), e._zod.check = (r) => {
    const o = r.value, i = o.length;
    if (i === t.length)
      return;
    const s = Ue(o), c = i > t.length;
    r.issues.push({
      origin: s,
      ...c ? { code: "too_big", maximum: t.length } : { code: "too_small", minimum: t.length },
      inclusive: !0,
      exact: !0,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Te = /* @__PURE__ */ u("$ZodCheckStringFormat", (e, t) => {
  var n, r;
  C.init(e, t), e._zod.onattach.push((o) => {
    const i = o._zod.bag;
    i.format = t.format, t.pattern && (i.patterns ?? (i.patterns = /* @__PURE__ */ new Set()), i.patterns.add(t.pattern));
  }), t.pattern ? (n = e._zod).check ?? (n.check = (o) => {
    t.pattern.lastIndex = 0, !t.pattern.test(o.value) && o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: t.format,
      input: o.value,
      ...t.pattern ? { pattern: t.pattern.toString() } : {},
      inst: e,
      continue: !t.abort
    });
  }) : (r = e._zod).check ?? (r.check = () => {
  });
}), Nr = /* @__PURE__ */ u("$ZodCheckRegex", (e, t) => {
  Te.init(e, t), e._zod.check = (n) => {
    t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: n.value,
      pattern: t.pattern.toString(),
      inst: e,
      continue: !t.abort
    });
  };
}), Ir = /* @__PURE__ */ u("$ZodCheckLowerCase", (e, t) => {
  t.pattern ?? (t.pattern = Er), Te.init(e, t);
}), $r = /* @__PURE__ */ u("$ZodCheckUpperCase", (e, t) => {
  t.pattern ?? (t.pattern = br), Te.init(e, t);
}), Rr = /* @__PURE__ */ u("$ZodCheckIncludes", (e, t) => {
  C.init(e, t);
  const n = we(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
  t.pattern = r, e._zod.onattach.push((o) => {
    const i = o._zod.bag;
    i.patterns ?? (i.patterns = /* @__PURE__ */ new Set()), i.patterns.add(r);
  }), e._zod.check = (o) => {
    o.value.includes(t.includes, t.position) || o.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: t.includes,
      input: o.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Ar = /* @__PURE__ */ u("$ZodCheckStartsWith", (e, t) => {
  C.init(e, t);
  const n = new RegExp(`^${we(t.prefix)}.*`);
  t.pattern ?? (t.pattern = n), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(n);
  }), e._zod.check = (r) => {
    r.value.startsWith(t.prefix) || r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: t.prefix,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Cr = /* @__PURE__ */ u("$ZodCheckEndsWith", (e, t) => {
  C.init(e, t);
  const n = new RegExp(`.*${we(t.suffix)}$`);
  t.pattern ?? (t.pattern = n), e._zod.onattach.push((r) => {
    const o = r._zod.bag;
    o.patterns ?? (o.patterns = /* @__PURE__ */ new Set()), o.patterns.add(n);
  }), e._zod.check = (r) => {
    r.value.endsWith(t.suffix) || r.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: t.suffix,
      input: r.value,
      inst: e,
      continue: !t.abort
    });
  };
}), Pr = /* @__PURE__ */ u("$ZodCheckOverwrite", (e, t) => {
  C.init(e, t), e._zod.check = (n) => {
    n.value = t.tx(n.value);
  };
});
class Zr {
  constructor(t = []) {
    this.content = [], this.indent = 0, this && (this.args = t);
  }
  indented(t) {
    this.indent += 1, t(this), this.indent -= 1;
  }
  write(t) {
    if (typeof t == "function") {
      t(this, { execution: "sync" }), t(this, { execution: "async" });
      return;
    }
    const r = t.split(`
`).filter((s) => s), o = Math.min(...r.map((s) => s.length - s.trimStart().length)), i = r.map((s) => s.slice(o)).map((s) => " ".repeat(this.indent * 2) + s);
    for (const s of i)
      this.content.push(s);
  }
  compile() {
    const t = Function, n = this?.args, o = [...(this?.content ?? [""]).map((i) => `  ${i}`)];
    return new t(...n, o.join(`
`));
  }
}
const Lr = {
  major: 4,
  minor: 4,
  patch: 3
}, O = /* @__PURE__ */ u("$ZodType", (e, t) => {
  var n;
  e ?? (e = {}), e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Lr;
  const r = [...e._zod.def.checks ?? []];
  e._zod.traits.has("$ZodCheck") && r.unshift(e);
  for (const o of r)
    for (const i of o._zod.onattach)
      i(e);
  if (r.length === 0)
    (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
      e._zod.run = e._zod.parse;
    });
  else {
    const o = (s, c, a) => {
      let l = q(s), d;
      for (const _ of c) {
        if (_._zod.def.when) {
          if (Dn(s) || !_._zod.def.when(s))
            continue;
        } else if (l)
          continue;
        const m = s.issues.length, h = _._zod.check(s);
        if (h instanceof Promise && a?.async === !1)
          throw new Y();
        if (d || h instanceof Promise)
          d = (d ?? Promise.resolve()).then(async () => {
            await h, s.issues.length !== m && (l || (l = q(s, m)));
          });
        else {
          if (s.issues.length === m)
            continue;
          l || (l = q(s, m));
        }
      }
      return d ? d.then(() => s) : s;
    }, i = (s, c, a) => {
      if (q(s))
        return s.aborted = !0, s;
      const l = o(c, r, a);
      if (l instanceof Promise) {
        if (a.async === !1)
          throw new Y();
        return l.then((d) => e._zod.parse(d, a));
      }
      return e._zod.parse(l, a);
    };
    e._zod.run = (s, c) => {
      if (c.skipChecks)
        return e._zod.parse(s, c);
      if (c.direction === "backward") {
        const l = e._zod.parse({ value: s.value, issues: [] }, { ...c, skipChecks: !0 });
        return l instanceof Promise ? l.then((d) => i(d, s, c)) : i(l, s, c);
      }
      const a = e._zod.parse(s, c);
      if (a instanceof Promise) {
        if (c.async === !1)
          throw new Y();
        return a.then((l) => o(l, r, c));
      }
      return o(a, r, c);
    };
  }
  b(e, "~standard", () => ({
    validate: (o) => {
      try {
        const i = Mn(e, o);
        return i.success ? { value: i.data } : { issues: i.error?.issues };
      } catch {
        return Fn(e, o).then((s) => s.success ? { value: s.data } : { issues: s.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
}), je = /* @__PURE__ */ u("$ZodString", (e, t) => {
  O.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? _r(e._zod.bag), e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = String(n.value);
      } catch {
      }
    return typeof n.value == "string" || n.issues.push({
      expected: "string",
      code: "invalid_type",
      input: n.value,
      inst: e
    }), n;
  };
}), T = /* @__PURE__ */ u("$ZodStringFormat", (e, t) => {
  Te.init(e, t), je.init(e, t);
}), Dr = /* @__PURE__ */ u("$ZodGUID", (e, t) => {
  t.pattern ?? (t.pattern = rr), T.init(e, t);
}), xr = /* @__PURE__ */ u("$ZodUUID", (e, t) => {
  if (t.version) {
    const r = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    }[t.version];
    if (r === void 0)
      throw new Error(`Invalid UUID version: "${t.version}"`);
    t.pattern ?? (t.pattern = et(r));
  } else
    t.pattern ?? (t.pattern = et());
  T.init(e, t);
}), Ur = /* @__PURE__ */ u("$ZodEmail", (e, t) => {
  t.pattern ?? (t.pattern = or), T.init(e, t);
}), Mr = /* @__PURE__ */ u("$ZodURL", (e, t) => {
  T.init(e, t), e._zod.check = (n) => {
    try {
      const r = n.value.trim();
      if (!t.normalize && t.protocol?.source === pr.source && !/^https?:\/\//i.test(r)) {
        n.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: n.value,
          inst: e,
          continue: !t.abort
        });
        return;
      }
      const o = new URL(r);
      t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(o.hostname) || n.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid hostname",
        pattern: t.hostname.source,
        input: n.value,
        inst: e,
        continue: !t.abort
      })), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(o.protocol.endsWith(":") ? o.protocol.slice(0, -1) : o.protocol) || n.issues.push({
        code: "invalid_format",
        format: "url",
        note: "Invalid protocol",
        pattern: t.protocol.source,
        input: n.value,
        inst: e,
        continue: !t.abort
      })), t.normalize ? n.value = o.href : n.value = r;
      return;
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "url",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
}), Fr = /* @__PURE__ */ u("$ZodEmoji", (e, t) => {
  t.pattern ?? (t.pattern = ir()), T.init(e, t);
}), jr = /* @__PURE__ */ u("$ZodNanoID", (e, t) => {
  t.pattern ?? (t.pattern = tr), T.init(e, t);
}), Gr = /* @__PURE__ */ u("$ZodCUID", (e, t) => {
  t.pattern ?? (t.pattern = Kn), T.init(e, t);
}), Wr = /* @__PURE__ */ u("$ZodCUID2", (e, t) => {
  t.pattern ?? (t.pattern = qn), T.init(e, t);
}), Jr = /* @__PURE__ */ u("$ZodULID", (e, t) => {
  t.pattern ?? (t.pattern = Yn), T.init(e, t);
}), Br = /* @__PURE__ */ u("$ZodXID", (e, t) => {
  t.pattern ?? (t.pattern = Qn), T.init(e, t);
}), Vr = /* @__PURE__ */ u("$ZodKSUID", (e, t) => {
  t.pattern ?? (t.pattern = er), T.init(e, t);
}), Xr = /* @__PURE__ */ u("$ZodISODateTime", (e, t) => {
  t.pattern ?? (t.pattern = gr(t)), T.init(e, t);
}), Hr = /* @__PURE__ */ u("$ZodISODate", (e, t) => {
  t.pattern ?? (t.pattern = hr), T.init(e, t);
}), Kr = /* @__PURE__ */ u("$ZodISOTime", (e, t) => {
  t.pattern ?? (t.pattern = mr(t)), T.init(e, t);
}), qr = /* @__PURE__ */ u("$ZodISODuration", (e, t) => {
  t.pattern ?? (t.pattern = nr), T.init(e, t);
}), Yr = /* @__PURE__ */ u("$ZodIPv4", (e, t) => {
  t.pattern ?? (t.pattern = cr), T.init(e, t), e._zod.bag.format = "ipv4";
}), Qr = /* @__PURE__ */ u("$ZodIPv6", (e, t) => {
  t.pattern ?? (t.pattern = ar), T.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
    try {
      new URL(`http://[${n.value}]`);
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
}), eo = /* @__PURE__ */ u("$ZodCIDRv4", (e, t) => {
  t.pattern ?? (t.pattern = ur), T.init(e, t);
}), to = /* @__PURE__ */ u("$ZodCIDRv6", (e, t) => {
  t.pattern ?? (t.pattern = lr), T.init(e, t), e._zod.check = (n) => {
    const r = n.value.split("/");
    try {
      if (r.length !== 2)
        throw new Error();
      const [o, i] = r;
      if (!i)
        throw new Error();
      const s = Number(i);
      if (`${s}` !== i)
        throw new Error();
      if (s < 0 || s > 128)
        throw new Error();
      new URL(`http://[${o}]`);
    } catch {
      n.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: n.value,
        inst: e,
        continue: !t.abort
      });
    }
  };
});
function Kt(e) {
  if (e === "")
    return !0;
  if (/\s/.test(e) || e.length % 4 !== 0)
    return !1;
  try {
    return atob(e), !0;
  } catch {
    return !1;
  }
}
const no = /* @__PURE__ */ u("$ZodBase64", (e, t) => {
  t.pattern ?? (t.pattern = dr), T.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
    Kt(n.value) || n.issues.push({
      code: "invalid_format",
      format: "base64",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
});
function ro(e) {
  if (!Wt.test(e))
    return !1;
  const t = e.replace(/[-_]/g, (r) => r === "-" ? "+" : "/"), n = t.padEnd(Math.ceil(t.length / 4) * 4, "=");
  return Kt(n);
}
const oo = /* @__PURE__ */ u("$ZodBase64URL", (e, t) => {
  t.pattern ?? (t.pattern = Wt), T.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
    ro(n.value) || n.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), so = /* @__PURE__ */ u("$ZodE164", (e, t) => {
  t.pattern ?? (t.pattern = fr), T.init(e, t);
});
function io(e, t = null) {
  try {
    const n = e.split(".");
    if (n.length !== 3)
      return !1;
    const [r] = n;
    if (!r)
      return !1;
    const o = JSON.parse(atob(r));
    return !("typ" in o && o?.typ !== "JWT" || !o.alg || t && (!("alg" in o) || o.alg !== t));
  } catch {
    return !1;
  }
}
const co = /* @__PURE__ */ u("$ZodJWT", (e, t) => {
  T.init(e, t), e._zod.check = (n) => {
    io(n.value, t.alg) || n.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: n.value,
      inst: e,
      continue: !t.abort
    });
  };
}), qt = /* @__PURE__ */ u("$ZodNumber", (e, t) => {
  O.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? yr, e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = Number(n.value);
      } catch {
      }
    const o = n.value;
    if (typeof o == "number" && !Number.isNaN(o) && Number.isFinite(o))
      return n;
    const i = typeof o == "number" ? Number.isNaN(o) ? "NaN" : Number.isFinite(o) ? void 0 : "Infinity" : void 0;
    return n.issues.push({
      expected: "number",
      code: "invalid_type",
      input: o,
      inst: e,
      ...i ? { received: i } : {}
    }), n;
  };
}), ao = /* @__PURE__ */ u("$ZodNumberFormat", (e, t) => {
  Sr.init(e, t), qt.init(e, t);
}), uo = /* @__PURE__ */ u("$ZodBoolean", (e, t) => {
  O.init(e, t), e._zod.pattern = wr, e._zod.parse = (n, r) => {
    if (t.coerce)
      try {
        n.value = !!n.value;
      } catch {
      }
    const o = n.value;
    return typeof o == "boolean" || n.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: o,
      inst: e
    }), n;
  };
}), lo = /* @__PURE__ */ u("$ZodUnknown", (e, t) => {
  O.init(e, t), e._zod.parse = (n) => n;
}), po = /* @__PURE__ */ u("$ZodNever", (e, t) => {
  O.init(e, t), e._zod.parse = (n, r) => (n.issues.push({
    expected: "never",
    code: "invalid_type",
    input: n.value,
    inst: e
  }), n);
});
function tt(e, t, n) {
  e.issues.length && t.issues.push(...Mt(n, e.issues)), t.value[n] = e.value;
}
const fo = /* @__PURE__ */ u("$ZodArray", (e, t) => {
  O.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value;
    if (!Array.isArray(o))
      return n.issues.push({
        expected: "array",
        code: "invalid_type",
        input: o,
        inst: e
      }), n;
    n.value = Array(o.length);
    const i = [];
    for (let s = 0; s < o.length; s++) {
      const c = o[s], a = t.element._zod.run({
        value: c,
        issues: []
      }, r);
      a instanceof Promise ? i.push(a.then((l) => tt(l, n, s))) : tt(a, n, s);
    }
    return i.length ? Promise.all(i).then(() => n) : n;
  };
});
function _e(e, t, n, r, o, i) {
  const s = n in r;
  if (e.issues.length) {
    if (o && i && !s)
      return;
    t.issues.push(...Mt(n, e.issues));
  }
  if (!s && !o) {
    e.issues.length || t.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: void 0,
      path: [n]
    });
    return;
  }
  e.value === void 0 ? s && (t.value[n] = void 0) : t.value[n] = e.value;
}
function Yt(e) {
  const t = Object.keys(e.shape);
  for (const r of t)
    if (!e.shape?.[r]?._zod?.traits?.has("$ZodType"))
      throw new Error(`Invalid element at key "${r}": expected a Zod schema`);
  const n = Nn(e.shape);
  return {
    ...e,
    keys: t,
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(n)
  };
}
function Qt(e, t, n, r, o, i) {
  const s = [], c = o.keySet, a = o.catchall._zod, l = a.def.type, d = a.optin === "optional", _ = a.optout === "optional";
  for (const m in t) {
    if (m === "__proto__" || c.has(m))
      continue;
    if (l === "never") {
      s.push(m);
      continue;
    }
    const h = a.run({ value: t[m], issues: [] }, r);
    h instanceof Promise ? e.push(h.then((E) => _e(E, n, m, t, d, _))) : _e(h, n, m, t, d, _);
  }
  return s.length && n.issues.push({
    code: "unrecognized_keys",
    keys: s,
    input: t,
    inst: i
  }), e.length ? Promise.all(e).then(() => n) : n;
}
const ho = /* @__PURE__ */ u("$ZodObject", (e, t) => {
  if (O.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
    const c = t.shape;
    Object.defineProperty(t, "shape", {
      get: () => {
        const a = { ...c };
        return Object.defineProperty(t, "shape", {
          value: a
        }), a;
      }
    });
  }
  const r = Le(() => Yt(t));
  b(e._zod, "propValues", () => {
    const c = t.shape, a = {};
    for (const l in c) {
      const d = c[l]._zod;
      if (d.values) {
        a[l] ?? (a[l] = /* @__PURE__ */ new Set());
        for (const _ of d.values)
          a[l].add(_);
      }
    }
    return a;
  });
  const o = ge, i = t.catchall;
  let s;
  e._zod.parse = (c, a) => {
    s ?? (s = r.value);
    const l = c.value;
    if (!o(l))
      return c.issues.push({
        expected: "object",
        code: "invalid_type",
        input: l,
        inst: e
      }), c;
    c.value = {};
    const d = [], _ = s.shape;
    for (const m of s.keys) {
      const h = _[m], E = h._zod.optin === "optional", ee = h._zod.optout === "optional", N = h._zod.run({ value: l[m], issues: [] }, a);
      N instanceof Promise ? d.push(N.then((ke) => _e(ke, c, m, l, E, ee))) : _e(N, c, m, l, E, ee);
    }
    return i ? Qt(d, l, c, a, r.value, e) : d.length ? Promise.all(d).then(() => c) : c;
  };
}), mo = /* @__PURE__ */ u("$ZodObjectJIT", (e, t) => {
  ho.init(e, t);
  const n = e._zod.parse, r = Le(() => Yt(t)), o = (m) => {
    const h = new Zr(["shape", "payload", "ctx"]), E = r.value, ee = (L) => {
      const k = Qe(L);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    h.write("const input = payload.value;");
    const N = /* @__PURE__ */ Object.create(null);
    let ke = 0;
    for (const L of E.keys)
      N[L] = `key_${ke++}`;
    h.write("const newResult = {};");
    for (const L of E.keys) {
      const k = N[L], $ = Qe(L), Be = m[L], Ve = Be?._zod?.optin === "optional", gn = Be?._zod?.optout === "optional";
      h.write(`const ${k} = ${ee(L)};`), Ve && gn ? h.write(`
        if (${k}.issues.length) {
          if (${$} in input) {
            payload.issues = payload.issues.concat(${k}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${$}, ...iss.path] : [${$}]
            })));
          }
        }
        
        if (${k}.value === undefined) {
          if (${$} in input) {
            newResult[${$}] = undefined;
          }
        } else {
          newResult[${$}] = ${k}.value;
        }
        
      `) : Ve ? h.write(`
        if (${k}.issues.length) {
          payload.issues = payload.issues.concat(${k}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${$}, ...iss.path] : [${$}]
          })));
        }
        
        if (${k}.value === undefined) {
          if (${$} in input) {
            newResult[${$}] = undefined;
          }
        } else {
          newResult[${$}] = ${k}.value;
        }
        
      `) : h.write(`
        const ${k}_present = ${$} in input;
        if (${k}.issues.length) {
          payload.issues = payload.issues.concat(${k}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${$}, ...iss.path] : [${$}]
          })));
        }
        if (!${k}_present && !${k}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${$}]
          });
        }

        if (${k}_present) {
          if (${k}.value === undefined) {
            newResult[${$}] = undefined;
          } else {
            newResult[${$}] = ${k}.value;
          }
        }

      `);
    }
    h.write("payload.value = newResult;"), h.write("return payload;");
    const mn = h.compile();
    return (L, k) => mn(m, L, k);
  };
  let i;
  const s = ge, c = !Ze.jitless, l = c && On.value, d = t.catchall;
  let _;
  e._zod.parse = (m, h) => {
    _ ?? (_ = r.value);
    const E = m.value;
    return s(E) ? c && l && h?.async === !1 && h.jitless !== !0 ? (i || (i = o(t.shape)), m = i(m, h), d ? Qt([], E, m, h, _, e) : m) : n(m, h) : (m.issues.push({
      expected: "object",
      code: "invalid_type",
      input: E,
      inst: e
    }), m);
  };
});
function nt(e, t, n, r) {
  for (const i of e)
    if (i.issues.length === 0)
      return t.value = i.value, t;
  const o = e.filter((i) => !q(i));
  return o.length === 1 ? (t.value = o[0].value, o[0]) : (t.issues.push({
    code: "invalid_union",
    input: t.value,
    inst: n,
    errors: e.map((i) => i.issues.map((s) => V(s, r, B())))
  }), t);
}
const go = /* @__PURE__ */ u("$ZodUnion", (e, t) => {
  O.init(e, t), b(e._zod, "optin", () => t.options.some((r) => r._zod.optin === "optional") ? "optional" : void 0), b(e._zod, "optout", () => t.options.some((r) => r._zod.optout === "optional") ? "optional" : void 0), b(e._zod, "values", () => {
    if (t.options.every((r) => r._zod.values))
      return new Set(t.options.flatMap((r) => Array.from(r._zod.values)));
  }), b(e._zod, "pattern", () => {
    if (t.options.every((r) => r._zod.pattern)) {
      const r = t.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${r.map((o) => xe(o.source)).join("|")})$`);
    }
  });
  const n = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (r, o) => {
    if (n)
      return n(r, o);
    let i = !1;
    const s = [];
    for (const c of t.options) {
      const a = c._zod.run({
        value: r.value,
        issues: []
      }, o);
      if (a instanceof Promise)
        s.push(a), i = !0;
      else {
        if (a.issues.length === 0)
          return a;
        s.push(a);
      }
    }
    return i ? Promise.all(s).then((c) => nt(c, r, e, o)) : nt(s, r, e, o);
  };
}), _o = /* @__PURE__ */ u("$ZodIntersection", (e, t) => {
  O.init(e, t), e._zod.parse = (n, r) => {
    const o = n.value, i = t.left._zod.run({ value: o, issues: [] }, r), s = t.right._zod.run({ value: o, issues: [] }, r);
    return i instanceof Promise || s instanceof Promise ? Promise.all([i, s]).then(([a, l]) => rt(n, a, l)) : rt(n, i, s);
  };
});
function $e(e, t) {
  if (e === t)
    return { valid: !0, data: e };
  if (e instanceof Date && t instanceof Date && +e == +t)
    return { valid: !0, data: e };
  if (ie(e) && ie(t)) {
    const n = Object.keys(t), r = Object.keys(e).filter((i) => n.indexOf(i) !== -1), o = { ...e, ...t };
    for (const i of r) {
      const s = $e(e[i], t[i]);
      if (!s.valid)
        return {
          valid: !1,
          mergeErrorPath: [i, ...s.mergeErrorPath]
        };
      o[i] = s.data;
    }
    return { valid: !0, data: o };
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length)
      return { valid: !1, mergeErrorPath: [] };
    const n = [];
    for (let r = 0; r < e.length; r++) {
      const o = e[r], i = t[r], s = $e(o, i);
      if (!s.valid)
        return {
          valid: !1,
          mergeErrorPath: [r, ...s.mergeErrorPath]
        };
      n.push(s.data);
    }
    return { valid: !0, data: n };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function rt(e, t, n) {
  const r = /* @__PURE__ */ new Map();
  let o;
  for (const c of t.issues)
    if (c.code === "unrecognized_keys") {
      o ?? (o = c);
      for (const a of c.keys)
        r.has(a) || r.set(a, {}), r.get(a).l = !0;
    } else
      e.issues.push(c);
  for (const c of n.issues)
    if (c.code === "unrecognized_keys")
      for (const a of c.keys)
        r.has(a) || r.set(a, {}), r.get(a).r = !0;
    else
      e.issues.push(c);
  const i = [...r].filter(([, c]) => c.l && c.r).map(([c]) => c);
  if (i.length && o && e.issues.push({ ...o, keys: i }), q(e))
    return e;
  const s = $e(t.value, n.value);
  if (!s.valid)
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(s.mergeErrorPath)}`);
  return e.value = s.data, e;
}
const vo = /* @__PURE__ */ u("$ZodEnum", (e, t) => {
  O.init(e, t);
  const n = Dt(t.entries), r = new Set(n);
  e._zod.values = r, e._zod.pattern = new RegExp(`^(${n.filter((o) => zn.has(typeof o)).map((o) => typeof o == "string" ? we(o) : o.toString()).join("|")})$`), e._zod.parse = (o, i) => {
    const s = o.value;
    return r.has(s) || o.issues.push({
      code: "invalid_value",
      values: n,
      input: s,
      inst: e
    }), o;
  };
}), yo = /* @__PURE__ */ u("$ZodTransform", (e, t) => {
  O.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
    if (r.direction === "backward")
      throw new Lt(e.constructor.name);
    const o = t.transform(n.value, n);
    if (r.async)
      return (o instanceof Promise ? o : Promise.resolve(o)).then((s) => (n.value = s, n.fallback = !0, n));
    if (o instanceof Promise)
      throw new Y();
    return n.value = o, n.fallback = !0, n;
  };
});
function ot(e, t) {
  return t === void 0 && (e.issues.length || e.fallback) ? { issues: [], value: void 0 } : e;
}
const en = /* @__PURE__ */ u("$ZodOptional", (e, t) => {
  O.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", b(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), b(e._zod, "pattern", () => {
    const n = t.innerType._zod.pattern;
    return n ? new RegExp(`^(${xe(n.source)})?$`) : void 0;
  }), e._zod.parse = (n, r) => {
    if (t.innerType._zod.optin === "optional") {
      const o = n.value, i = t.innerType._zod.run(n, r);
      return i instanceof Promise ? i.then((s) => ot(s, o)) : ot(i, o);
    }
    return n.value === void 0 ? n : t.innerType._zod.run(n, r);
  };
}), wo = /* @__PURE__ */ u("$ZodExactOptional", (e, t) => {
  en.init(e, t), b(e._zod, "values", () => t.innerType._zod.values), b(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (n, r) => t.innerType._zod.run(n, r);
}), Eo = /* @__PURE__ */ u("$ZodNullable", (e, t) => {
  O.init(e, t), b(e._zod, "optin", () => t.innerType._zod.optin), b(e._zod, "optout", () => t.innerType._zod.optout), b(e._zod, "pattern", () => {
    const n = t.innerType._zod.pattern;
    return n ? new RegExp(`^(${xe(n.source)}|null)$`) : void 0;
  }), b(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (n, r) => n.value === null ? n : t.innerType._zod.run(n, r);
}), bo = /* @__PURE__ */ u("$ZodDefault", (e, t) => {
  O.init(e, t), e._zod.optin = "optional", b(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => {
    if (r.direction === "backward")
      return t.innerType._zod.run(n, r);
    if (n.value === void 0)
      return n.value = t.defaultValue, n;
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((i) => st(i, t)) : st(o, t);
  };
});
function st(e, t) {
  return e.value === void 0 && (e.value = t.defaultValue), e;
}
const To = /* @__PURE__ */ u("$ZodPrefault", (e, t) => {
  O.init(e, t), e._zod.optin = "optional", b(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => (r.direction === "backward" || n.value === void 0 && (n.value = t.defaultValue), t.innerType._zod.run(n, r));
}), So = /* @__PURE__ */ u("$ZodNonOptional", (e, t) => {
  O.init(e, t), b(e._zod, "values", () => {
    const n = t.innerType._zod.values;
    return n ? new Set([...n].filter((r) => r !== void 0)) : void 0;
  }), e._zod.parse = (n, r) => {
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((i) => it(i, e)) : it(o, e);
  };
});
function it(e, t) {
  return !e.issues.length && e.value === void 0 && e.issues.push({
    code: "invalid_type",
    expected: "nonoptional",
    input: e.value,
    inst: t
  }), e;
}
const ko = /* @__PURE__ */ u("$ZodCatch", (e, t) => {
  O.init(e, t), e._zod.optin = "optional", b(e._zod, "optout", () => t.innerType._zod.optout), b(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (n, r) => {
    if (r.direction === "backward")
      return t.innerType._zod.run(n, r);
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then((i) => (n.value = i.value, i.issues.length && (n.value = t.catchValue({
      ...n,
      error: {
        issues: i.issues.map((s) => V(s, r, B()))
      },
      input: n.value
    }), n.issues = [], n.fallback = !0), n)) : (n.value = o.value, o.issues.length && (n.value = t.catchValue({
      ...n,
      error: {
        issues: o.issues.map((i) => V(i, r, B()))
      },
      input: n.value
    }), n.issues = [], n.fallback = !0), n);
  };
}), Oo = /* @__PURE__ */ u("$ZodPipe", (e, t) => {
  O.init(e, t), b(e._zod, "values", () => t.in._zod.values), b(e._zod, "optin", () => t.in._zod.optin), b(e._zod, "optout", () => t.out._zod.optout), b(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (n, r) => {
    if (r.direction === "backward") {
      const i = t.out._zod.run(n, r);
      return i instanceof Promise ? i.then((s) => de(s, t.in, r)) : de(i, t.in, r);
    }
    const o = t.in._zod.run(n, r);
    return o instanceof Promise ? o.then((i) => de(i, t.out, r)) : de(o, t.out, r);
  };
});
function de(e, t, n) {
  return e.issues.length ? (e.aborted = !0, e) : t._zod.run({ value: e.value, issues: e.issues, fallback: e.fallback }, n);
}
const zo = /* @__PURE__ */ u("$ZodReadonly", (e, t) => {
  O.init(e, t), b(e._zod, "propValues", () => t.innerType._zod.propValues), b(e._zod, "values", () => t.innerType._zod.values), b(e._zod, "optin", () => t.innerType?._zod?.optin), b(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (n, r) => {
    if (r.direction === "backward")
      return t.innerType._zod.run(n, r);
    const o = t.innerType._zod.run(n, r);
    return o instanceof Promise ? o.then(ct) : ct(o);
  };
});
function ct(e) {
  return e.value = Object.freeze(e.value), e;
}
const No = /* @__PURE__ */ u("$ZodCustom", (e, t) => {
  C.init(e, t), O.init(e, t), e._zod.parse = (n, r) => n, e._zod.check = (n) => {
    const r = n.value, o = t.fn(r);
    if (o instanceof Promise)
      return o.then((i) => at(i, n, r, e));
    at(o, n, r, e);
  };
});
function at(e, t, n, r) {
  if (!e) {
    const o = {
      code: "custom",
      input: n,
      inst: r,
      // incorporates params.error into issue reporting
      path: [...r._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !r._zod.def.abort
      // params: inst._zod.def.params,
    };
    r._zod.def.params && (o.params = r._zod.def.params), t.issues.push(ce(o));
  }
}
var ut;
class Io {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
  }
  add(t, ...n) {
    const r = n[0];
    return this._map.set(t, r), r && typeof r == "object" && "id" in r && this._idmap.set(r.id, t), this;
  }
  clear() {
    return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
  }
  remove(t) {
    const n = this._map.get(t);
    return n && typeof n == "object" && "id" in n && this._idmap.delete(n.id), this._map.delete(t), this;
  }
  get(t) {
    const n = t._zod.parent;
    if (n) {
      const r = { ...this.get(n) ?? {} };
      delete r.id;
      const o = { ...r, ...this._map.get(t) };
      return Object.keys(o).length ? o : void 0;
    }
    return this._map.get(t);
  }
  has(t) {
    return this._map.has(t);
  }
}
function $o() {
  return new Io();
}
(ut = globalThis).__zod_globalRegistry ?? (ut.__zod_globalRegistry = $o());
const ne = globalThis.__zod_globalRegistry;
// @__NO_SIDE_EFFECTS__
function Ro(e, t) {
  return new e({
    type: "string",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ao(e, t) {
  return new e({
    type: "string",
    format: "email",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function lt(e, t) {
  return new e({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Co(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Po(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v4",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Zo(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v6",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Lo(e, t) {
  return new e({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: !1,
    version: "v7",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Do(e, t) {
  return new e({
    type: "string",
    format: "url",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function xo(e, t) {
  return new e({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Uo(e, t) {
  return new e({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Mo(e, t) {
  return new e({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Fo(e, t) {
  return new e({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function jo(e, t) {
  return new e({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Go(e, t) {
  return new e({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Wo(e, t) {
  return new e({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Jo(e, t) {
  return new e({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Bo(e, t) {
  return new e({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Vo(e, t) {
  return new e({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Xo(e, t) {
  return new e({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ho(e, t) {
  return new e({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Ko(e, t) {
  return new e({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function qo(e, t) {
  return new e({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Yo(e, t) {
  return new e({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: !1,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function Qo(e, t) {
  return new e({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: !1,
    local: !1,
    precision: null,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function es(e, t) {
  return new e({
    type: "string",
    format: "date",
    check: "string_format",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function ts(e, t) {
  return new e({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function ns(e, t) {
  return new e({
    type: "string",
    format: "duration",
    check: "string_format",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function rs(e, t) {
  return new e({
    type: "number",
    checks: [],
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function os(e, t) {
  return new e({
    type: "number",
    check: "number_format",
    abort: !1,
    format: "safeint",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function ss(e, t) {
  return new e({
    type: "boolean",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function is(e) {
  return new e({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function cs(e, t) {
  return new e({
    type: "never",
    ...f(t)
  });
}
// @__NO_SIDE_EFFECTS__
function dt(e, t) {
  return new Xt({
    check: "less_than",
    ...f(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function ze(e, t) {
  return new Xt({
    check: "less_than",
    ...f(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function pt(e, t) {
  return new Ht({
    check: "greater_than",
    ...f(t),
    value: e,
    inclusive: !1
  });
}
// @__NO_SIDE_EFFECTS__
function Ne(e, t) {
  return new Ht({
    check: "greater_than",
    ...f(t),
    value: e,
    inclusive: !0
  });
}
// @__NO_SIDE_EFFECTS__
function ft(e, t) {
  return new Tr({
    check: "multiple_of",
    ...f(t),
    value: e
  });
}
// @__NO_SIDE_EFFECTS__
function tn(e, t) {
  return new kr({
    check: "max_length",
    ...f(t),
    maximum: e
  });
}
// @__NO_SIDE_EFFECTS__
function ve(e, t) {
  return new Or({
    check: "min_length",
    ...f(t),
    minimum: e
  });
}
// @__NO_SIDE_EFFECTS__
function nn(e, t) {
  return new zr({
    check: "length_equals",
    ...f(t),
    length: e
  });
}
// @__NO_SIDE_EFFECTS__
function as(e, t) {
  return new Nr({
    check: "string_format",
    format: "regex",
    ...f(t),
    pattern: e
  });
}
// @__NO_SIDE_EFFECTS__
function us(e) {
  return new Ir({
    check: "string_format",
    format: "lowercase",
    ...f(e)
  });
}
// @__NO_SIDE_EFFECTS__
function ls(e) {
  return new $r({
    check: "string_format",
    format: "uppercase",
    ...f(e)
  });
}
// @__NO_SIDE_EFFECTS__
function ds(e, t) {
  return new Rr({
    check: "string_format",
    format: "includes",
    ...f(t),
    includes: e
  });
}
// @__NO_SIDE_EFFECTS__
function ps(e, t) {
  return new Ar({
    check: "string_format",
    format: "starts_with",
    ...f(t),
    prefix: e
  });
}
// @__NO_SIDE_EFFECTS__
function fs(e, t) {
  return new Cr({
    check: "string_format",
    format: "ends_with",
    ...f(t),
    suffix: e
  });
}
// @__NO_SIDE_EFFECTS__
function Q(e) {
  return new Pr({
    check: "overwrite",
    tx: e
  });
}
// @__NO_SIDE_EFFECTS__
function hs(e) {
  return /* @__PURE__ */ Q((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function ms() {
  return /* @__PURE__ */ Q((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function gs() {
  return /* @__PURE__ */ Q((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _s() {
  return /* @__PURE__ */ Q((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function vs() {
  return /* @__PURE__ */ Q((e) => kn(e));
}
// @__NO_SIDE_EFFECTS__
function ys(e, t, n) {
  return new e({
    type: "array",
    element: t,
    // get element() {
    //   return element;
    // },
    ...f(n)
  });
}
// @__NO_SIDE_EFFECTS__
function ws(e, t, n) {
  return new e({
    type: "custom",
    check: "custom",
    fn: t,
    ...f(n)
  });
}
// @__NO_SIDE_EFFECTS__
function Es(e, t) {
  const n = /* @__PURE__ */ bs((r) => (r.addIssue = (o) => {
    if (typeof o == "string")
      r.issues.push(ce(o, r.value, n._zod.def));
    else {
      const i = o;
      i.fatal && (i.continue = !1), i.code ?? (i.code = "custom"), i.input ?? (i.input = r.value), i.inst ?? (i.inst = n), i.continue ?? (i.continue = !n._zod.def.abort), r.issues.push(ce(i));
    }
  }, e(r.value, r)), t);
  return n;
}
// @__NO_SIDE_EFFECTS__
function bs(e, t) {
  const n = new C({
    check: "custom",
    ...f(t)
  });
  return n._zod.check = e, n;
}
function rn(e) {
  let t = e?.target ?? "draft-2020-12";
  return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
    processors: e.processors ?? {},
    metadataRegistry: e?.metadata ?? ne,
    target: t,
    unrepresentable: e?.unrepresentable ?? "throw",
    override: e?.override ?? (() => {
    }),
    io: e?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: e?.cycles ?? "ref",
    reused: e?.reused ?? "inline",
    external: e?.external ?? void 0
  };
}
function R(e, t, n = { path: [], schemaPath: [] }) {
  var r;
  const o = e._zod.def, i = t.seen.get(e);
  if (i)
    return i.count++, n.schemaPath.includes(e) && (i.cycle = n.path), i.schema;
  const s = { schema: {}, count: 1, cycle: void 0, path: n.path };
  t.seen.set(e, s);
  const c = e._zod.toJSONSchema?.();
  if (c)
    s.schema = c;
  else {
    const d = {
      ...n,
      schemaPath: [...n.schemaPath, e],
      path: n.path
    };
    if (e._zod.processJSONSchema)
      e._zod.processJSONSchema(t, s.schema, d);
    else {
      const m = s.schema, h = t.processors[o.type];
      if (!h)
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${o.type}`);
      h(e, t, m, d);
    }
    const _ = e._zod.parent;
    _ && (s.ref || (s.ref = _), R(_, t, d), t.seen.get(_).isParent = !0);
  }
  const a = t.metadataRegistry.get(e);
  return a && Object.assign(s.schema, a), t.io === "input" && A(e) && (delete s.schema.examples, delete s.schema.default), t.io === "input" && "_prefault" in s.schema && ((r = s.schema).default ?? (r.default = s.schema._prefault)), delete s.schema._prefault, t.seen.get(e).schema;
}
function on(e, t) {
  const n = e.seen.get(t);
  if (!n)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = /* @__PURE__ */ new Map();
  for (const s of e.seen.entries()) {
    const c = e.metadataRegistry.get(s[0])?.id;
    if (c) {
      const a = r.get(c);
      if (a && a !== s[0])
        throw new Error(`Duplicate schema id "${c}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      r.set(c, s[0]);
    }
  }
  const o = (s) => {
    const c = e.target === "draft-2020-12" ? "$defs" : "definitions";
    if (e.external) {
      const _ = e.external.registry.get(s[0])?.id, m = e.external.uri ?? ((E) => E);
      if (_)
        return { ref: m(_) };
      const h = s[1].defId ?? s[1].schema.id ?? `schema${e.counter++}`;
      return s[1].defId = h, { defId: h, ref: `${m("__shared")}#/${c}/${h}` };
    }
    if (s[1] === n)
      return { ref: "#" };
    const l = `#/${c}/`, d = s[1].schema.id ?? `__schema${e.counter++}`;
    return { defId: d, ref: l + d };
  }, i = (s) => {
    if (s[1].schema.$ref)
      return;
    const c = s[1], { ref: a, defId: l } = o(s);
    c.def = { ...c.schema }, l && (c.defId = l);
    const d = c.schema;
    for (const _ in d)
      delete d[_];
    d.$ref = a;
  };
  if (e.cycles === "throw")
    for (const s of e.seen.entries()) {
      const c = s[1];
      if (c.cycle)
        throw new Error(`Cycle detected: #/${c.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (const s of e.seen.entries()) {
    const c = s[1];
    if (t === s[0]) {
      i(s);
      continue;
    }
    if (e.external) {
      const l = e.external.registry.get(s[0])?.id;
      if (t !== s[0] && l) {
        i(s);
        continue;
      }
    }
    if (e.metadataRegistry.get(s[0])?.id) {
      i(s);
      continue;
    }
    if (c.cycle) {
      i(s);
      continue;
    }
    if (c.count > 1 && e.reused === "ref") {
      i(s);
      continue;
    }
  }
}
function sn(e, t) {
  const n = e.seen.get(t);
  if (!n)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const r = (c) => {
    const a = e.seen.get(c);
    if (a.ref === null)
      return;
    const l = a.def ?? a.schema, d = { ...l }, _ = a.ref;
    if (a.ref = null, _) {
      r(_);
      const h = e.seen.get(_), E = h.schema;
      if (E.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (l.allOf = l.allOf ?? [], l.allOf.push(E)) : Object.assign(l, E), Object.assign(l, d), c._zod.parent === _)
        for (const N in l)
          N === "$ref" || N === "allOf" || N in d || delete l[N];
      if (E.$ref && h.def)
        for (const N in l)
          N === "$ref" || N === "allOf" || N in h.def && JSON.stringify(l[N]) === JSON.stringify(h.def[N]) && delete l[N];
    }
    const m = c._zod.parent;
    if (m && m !== _) {
      r(m);
      const h = e.seen.get(m);
      if (h?.schema.$ref && (l.$ref = h.schema.$ref, h.def))
        for (const E in l)
          E === "$ref" || E === "allOf" || E in h.def && JSON.stringify(l[E]) === JSON.stringify(h.def[E]) && delete l[E];
    }
    e.override({
      zodSchema: c,
      jsonSchema: l,
      path: a.path ?? []
    });
  };
  for (const c of [...e.seen.entries()].reverse())
    r(c[0]);
  const o = {};
  if (e.target === "draft-2020-12" ? o.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? o.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? o.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
    const c = e.external.registry.get(t)?.id;
    if (!c)
      throw new Error("Schema is missing an `id` property");
    o.$id = e.external.uri(c);
  }
  Object.assign(o, n.def ?? n.schema);
  const i = e.metadataRegistry.get(t)?.id;
  i !== void 0 && o.id === i && delete o.id;
  const s = e.external?.defs ?? {};
  for (const c of e.seen.entries()) {
    const a = c[1];
    a.def && a.defId && (a.def.id === a.defId && delete a.def.id, s[a.defId] = a.def);
  }
  e.external || Object.keys(s).length > 0 && (e.target === "draft-2020-12" ? o.$defs = s : o.definitions = s);
  try {
    const c = JSON.parse(JSON.stringify(o));
    return Object.defineProperty(c, "~standard", {
      value: {
        ...t["~standard"],
        jsonSchema: {
          input: ye(t, "input", e.processors),
          output: ye(t, "output", e.processors)
        }
      },
      enumerable: !1,
      writable: !1
    }), c;
  } catch {
    throw new Error("Error converting schema to JSON.");
  }
}
function A(e, t) {
  const n = t ?? { seen: /* @__PURE__ */ new Set() };
  if (n.seen.has(e))
    return !1;
  n.seen.add(e);
  const r = e._zod.def;
  if (r.type === "transform")
    return !0;
  if (r.type === "array")
    return A(r.element, n);
  if (r.type === "set")
    return A(r.valueType, n);
  if (r.type === "lazy")
    return A(r.getter(), n);
  if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault")
    return A(r.innerType, n);
  if (r.type === "intersection")
    return A(r.left, n) || A(r.right, n);
  if (r.type === "record" || r.type === "map")
    return A(r.keyType, n) || A(r.valueType, n);
  if (r.type === "pipe")
    return e._zod.traits.has("$ZodCodec") ? !0 : A(r.in, n) || A(r.out, n);
  if (r.type === "object") {
    for (const o in r.shape)
      if (A(r.shape[o], n))
        return !0;
    return !1;
  }
  if (r.type === "union") {
    for (const o of r.options)
      if (A(o, n))
        return !0;
    return !1;
  }
  if (r.type === "tuple") {
    for (const o of r.items)
      if (A(o, n))
        return !0;
    return !!(r.rest && A(r.rest, n));
  }
  return !1;
}
const Ts = (e, t = {}) => (n) => {
  const r = rn({ ...n, processors: t });
  return R(e, r), on(r, e), sn(r, e);
}, ye = (e, t, n = {}) => (r) => {
  const { libraryOptions: o, target: i } = r ?? {}, s = rn({ ...o ?? {}, target: i, io: t, processors: n });
  return R(e, s), on(s, e), sn(s, e);
}, Ss = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
}, ks = (e, t, n, r) => {
  const o = n;
  o.type = "string";
  const { minimum: i, maximum: s, format: c, patterns: a, contentEncoding: l } = e._zod.bag;
  if (typeof i == "number" && (o.minLength = i), typeof s == "number" && (o.maxLength = s), c && (o.format = Ss[c] ?? c, o.format === "" && delete o.format, c === "time" && delete o.format), l && (o.contentEncoding = l), a && a.size > 0) {
    const d = [...a];
    d.length === 1 ? o.pattern = d[0].source : d.length > 1 && (o.allOf = [
      ...d.map((_) => ({
        ...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
        pattern: _.source
      }))
    ]);
  }
}, Os = (e, t, n, r) => {
  const o = n, { minimum: i, maximum: s, format: c, multipleOf: a, exclusiveMaximum: l, exclusiveMinimum: d } = e._zod.bag;
  typeof c == "string" && c.includes("int") ? o.type = "integer" : o.type = "number";
  const _ = typeof d == "number" && d >= (i ?? Number.NEGATIVE_INFINITY), m = typeof l == "number" && l <= (s ?? Number.POSITIVE_INFINITY), h = t.target === "draft-04" || t.target === "openapi-3.0";
  _ ? h ? (o.minimum = d, o.exclusiveMinimum = !0) : o.exclusiveMinimum = d : typeof i == "number" && (o.minimum = i), m ? h ? (o.maximum = l, o.exclusiveMaximum = !0) : o.exclusiveMaximum = l : typeof s == "number" && (o.maximum = s), typeof a == "number" && (o.multipleOf = a);
}, zs = (e, t, n, r) => {
  n.type = "boolean";
}, Ns = (e, t, n, r) => {
  n.not = {};
}, Is = (e, t, n, r) => {
}, $s = (e, t, n, r) => {
  const o = e._zod.def, i = Dt(o.entries);
  i.every((s) => typeof s == "number") && (n.type = "number"), i.every((s) => typeof s == "string") && (n.type = "string"), n.enum = i;
}, Rs = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Custom types cannot be represented in JSON Schema");
}, As = (e, t, n, r) => {
  if (t.unrepresentable === "throw")
    throw new Error("Transforms cannot be represented in JSON Schema");
}, Cs = (e, t, n, r) => {
  const o = n, i = e._zod.def, { minimum: s, maximum: c } = e._zod.bag;
  typeof s == "number" && (o.minItems = s), typeof c == "number" && (o.maxItems = c), o.type = "array", o.items = R(i.element, t, {
    ...r,
    path: [...r.path, "items"]
  });
}, Ps = (e, t, n, r) => {
  const o = n, i = e._zod.def;
  o.type = "object", o.properties = {};
  const s = i.shape;
  for (const l in s)
    o.properties[l] = R(s[l], t, {
      ...r,
      path: [...r.path, "properties", l]
    });
  const c = new Set(Object.keys(s)), a = new Set([...c].filter((l) => {
    const d = i.shape[l]._zod;
    return t.io === "input" ? d.optin === void 0 : d.optout === void 0;
  }));
  a.size > 0 && (o.required = Array.from(a)), i.catchall?._zod.def.type === "never" ? o.additionalProperties = !1 : i.catchall ? i.catchall && (o.additionalProperties = R(i.catchall, t, {
    ...r,
    path: [...r.path, "additionalProperties"]
  })) : t.io === "output" && (o.additionalProperties = !1);
}, Zs = (e, t, n, r) => {
  const o = e._zod.def, i = o.inclusive === !1, s = o.options.map((c, a) => R(c, t, {
    ...r,
    path: [...r.path, i ? "oneOf" : "anyOf", a]
  }));
  i ? n.oneOf = s : n.anyOf = s;
}, Ls = (e, t, n, r) => {
  const o = e._zod.def, i = R(o.left, t, {
    ...r,
    path: [...r.path, "allOf", 0]
  }), s = R(o.right, t, {
    ...r,
    path: [...r.path, "allOf", 1]
  }), c = (l) => "allOf" in l && Object.keys(l).length === 1, a = [
    ...c(i) ? i.allOf : [i],
    ...c(s) ? s.allOf : [s]
  ];
  n.allOf = a;
}, Ds = (e, t, n, r) => {
  const o = e._zod.def, i = R(o.innerType, t, r), s = t.seen.get(e);
  t.target === "openapi-3.0" ? (s.ref = o.innerType, n.nullable = !0) : n.anyOf = [i, { type: "null" }];
}, xs = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType;
}, Us = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType, n.default = JSON.parse(JSON.stringify(o.defaultValue));
}, Ms = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(o.defaultValue)));
}, Fs = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType;
  let s;
  try {
    s = o.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  n.default = s;
}, js = (e, t, n, r) => {
  const o = e._zod.def, i = o.in._zod.traits.has("$ZodTransform"), s = t.io === "input" ? i ? o.out : o.in : o.out;
  R(s, t, r);
  const c = t.seen.get(e);
  c.ref = s;
}, Gs = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType, n.readOnly = !0;
}, cn = (e, t, n, r) => {
  const o = e._zod.def;
  R(o.innerType, t, r);
  const i = t.seen.get(e);
  i.ref = o.innerType;
}, Ws = /* @__PURE__ */ u("ZodISODateTime", (e, t) => {
  Xr.init(e, t), S.init(e, t);
});
function Js(e) {
  return /* @__PURE__ */ Qo(Ws, e);
}
const Bs = /* @__PURE__ */ u("ZodISODate", (e, t) => {
  Hr.init(e, t), S.init(e, t);
});
function Vs(e) {
  return /* @__PURE__ */ es(Bs, e);
}
const Xs = /* @__PURE__ */ u("ZodISOTime", (e, t) => {
  Kr.init(e, t), S.init(e, t);
});
function Hs(e) {
  return /* @__PURE__ */ ts(Xs, e);
}
const Ks = /* @__PURE__ */ u("ZodISODuration", (e, t) => {
  qr.init(e, t), S.init(e, t);
});
function qs(e) {
  return /* @__PURE__ */ ns(Ks, e);
}
const Ys = (e, t) => {
  jt.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
    format: {
      value: (n) => Un(e, n)
      // enumerable: false,
    },
    flatten: {
      value: (n) => xn(e, n)
      // enumerable: false,
    },
    addIssue: {
      value: (n) => {
        e.issues.push(n), e.message = JSON.stringify(e.issues, Ie, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (n) => {
        e.issues.push(...n), e.message = JSON.stringify(e.issues, Ie, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return e.issues.length === 0;
      }
      // enumerable: false,
    }
  });
}, P = /* @__PURE__ */ u("ZodError", Ys, {
  Parent: Error
}), Qs = /* @__PURE__ */ Me(P), ei = /* @__PURE__ */ Fe(P), ti = /* @__PURE__ */ Ee(P), ni = /* @__PURE__ */ be(P), ri = /* @__PURE__ */ jn(P), oi = /* @__PURE__ */ Gn(P), si = /* @__PURE__ */ Wn(P), ii = /* @__PURE__ */ Jn(P), ci = /* @__PURE__ */ Bn(P), ai = /* @__PURE__ */ Vn(P), ui = /* @__PURE__ */ Xn(P), li = /* @__PURE__ */ Hn(P), ht = /* @__PURE__ */ new WeakMap();
function ue(e, t, n) {
  const r = Object.getPrototypeOf(e);
  let o = ht.get(r);
  if (o || (o = /* @__PURE__ */ new Set(), ht.set(r, o)), !o.has(t)) {
    o.add(t);
    for (const i in n) {
      const s = n[i];
      Object.defineProperty(r, i, {
        configurable: !0,
        enumerable: !1,
        get() {
          const c = s.bind(this);
          return Object.defineProperty(this, i, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: c
          }), c;
        },
        set(c) {
          Object.defineProperty(this, i, {
            configurable: !0,
            writable: !0,
            enumerable: !0,
            value: c
          });
        }
      });
    }
  }
}
const z = /* @__PURE__ */ u("ZodType", (e, t) => (O.init(e, t), Object.assign(e["~standard"], {
  jsonSchema: {
    input: ye(e, "input"),
    output: ye(e, "output")
  }
}), e.toJSONSchema = Ts(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (n, r) => Qs(e, n, r, { callee: e.parse }), e.safeParse = (n, r) => ti(e, n, r), e.parseAsync = async (n, r) => ei(e, n, r, { callee: e.parseAsync }), e.safeParseAsync = async (n, r) => ni(e, n, r), e.spa = e.safeParseAsync, e.encode = (n, r) => ri(e, n, r), e.decode = (n, r) => oi(e, n, r), e.encodeAsync = async (n, r) => si(e, n, r), e.decodeAsync = async (n, r) => ii(e, n, r), e.safeEncode = (n, r) => ci(e, n, r), e.safeDecode = (n, r) => ai(e, n, r), e.safeEncodeAsync = async (n, r) => ui(e, n, r), e.safeDecodeAsync = async (n, r) => li(e, n, r), ue(e, "ZodType", {
  check(...n) {
    const r = this.def;
    return this.clone(G(r, {
      checks: [
        ...r.checks ?? [],
        ...n.map((o) => typeof o == "function" ? { _zod: { check: o, def: { check: "custom" }, onattach: [] } } : o)
      ]
    }), { parent: !0 });
  },
  with(...n) {
    return this.check(...n);
  },
  clone(n, r) {
    return W(this, n, r);
  },
  brand() {
    return this;
  },
  register(n, r) {
    return n.add(this, r), this;
  },
  refine(n, r) {
    return this.check(nc(n, r));
  },
  superRefine(n, r) {
    return this.check(rc(n, r));
  },
  overwrite(n) {
    return this.check(/* @__PURE__ */ Q(n));
  },
  optional() {
    return vt(this);
  },
  exactOptional() {
    return Gi(this);
  },
  nullable() {
    return yt(this);
  },
  nullish() {
    return vt(yt(this));
  },
  nonoptional(n) {
    return Hi(this, n);
  },
  array() {
    return ln(this);
  },
  or(n) {
    return Di([this, n]);
  },
  and(n) {
    return Ui(this, n);
  },
  transform(n) {
    return wt(this, Fi(n));
  },
  default(n) {
    return Bi(this, n);
  },
  prefault(n) {
    return Xi(this, n);
  },
  catch(n) {
    return qi(this, n);
  },
  pipe(n) {
    return wt(this, n);
  },
  readonly() {
    return ec(this);
  },
  describe(n) {
    const r = this.clone();
    return ne.add(r, { description: n }), r;
  },
  meta(...n) {
    if (n.length === 0)
      return ne.get(this);
    const r = this.clone();
    return ne.add(r, n[0]), r;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(n) {
    return n(this);
  }
}), Object.defineProperty(e, "description", {
  get() {
    return ne.get(e)?.description;
  },
  configurable: !0
}), e)), an = /* @__PURE__ */ u("_ZodString", (e, t) => {
  je.init(e, t), z.init(e, t), e._zod.processJSONSchema = (r, o, i) => ks(e, r, o);
  const n = e._zod.bag;
  e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, ue(e, "_ZodString", {
    regex(...r) {
      return this.check(/* @__PURE__ */ as(...r));
    },
    includes(...r) {
      return this.check(/* @__PURE__ */ ds(...r));
    },
    startsWith(...r) {
      return this.check(/* @__PURE__ */ ps(...r));
    },
    endsWith(...r) {
      return this.check(/* @__PURE__ */ fs(...r));
    },
    min(...r) {
      return this.check(/* @__PURE__ */ ve(...r));
    },
    max(...r) {
      return this.check(/* @__PURE__ */ tn(...r));
    },
    length(...r) {
      return this.check(/* @__PURE__ */ nn(...r));
    },
    nonempty(...r) {
      return this.check(/* @__PURE__ */ ve(1, ...r));
    },
    lowercase(r) {
      return this.check(/* @__PURE__ */ us(r));
    },
    uppercase(r) {
      return this.check(/* @__PURE__ */ ls(r));
    },
    trim() {
      return this.check(/* @__PURE__ */ ms());
    },
    normalize(...r) {
      return this.check(/* @__PURE__ */ hs(...r));
    },
    toLowerCase() {
      return this.check(/* @__PURE__ */ gs());
    },
    toUpperCase() {
      return this.check(/* @__PURE__ */ _s());
    },
    slugify() {
      return this.check(/* @__PURE__ */ vs());
    }
  });
}), di = /* @__PURE__ */ u("ZodString", (e, t) => {
  je.init(e, t), an.init(e, t), e.email = (n) => e.check(/* @__PURE__ */ Ao(pi, n)), e.url = (n) => e.check(/* @__PURE__ */ Do(fi, n)), e.jwt = (n) => e.check(/* @__PURE__ */ Yo(Ni, n)), e.emoji = (n) => e.check(/* @__PURE__ */ xo(hi, n)), e.guid = (n) => e.check(/* @__PURE__ */ lt(mt, n)), e.uuid = (n) => e.check(/* @__PURE__ */ Co(pe, n)), e.uuidv4 = (n) => e.check(/* @__PURE__ */ Po(pe, n)), e.uuidv6 = (n) => e.check(/* @__PURE__ */ Zo(pe, n)), e.uuidv7 = (n) => e.check(/* @__PURE__ */ Lo(pe, n)), e.nanoid = (n) => e.check(/* @__PURE__ */ Uo(mi, n)), e.guid = (n) => e.check(/* @__PURE__ */ lt(mt, n)), e.cuid = (n) => e.check(/* @__PURE__ */ Mo(gi, n)), e.cuid2 = (n) => e.check(/* @__PURE__ */ Fo(_i, n)), e.ulid = (n) => e.check(/* @__PURE__ */ jo(vi, n)), e.base64 = (n) => e.check(/* @__PURE__ */ Ho(ki, n)), e.base64url = (n) => e.check(/* @__PURE__ */ Ko(Oi, n)), e.xid = (n) => e.check(/* @__PURE__ */ Go(yi, n)), e.ksuid = (n) => e.check(/* @__PURE__ */ Wo(wi, n)), e.ipv4 = (n) => e.check(/* @__PURE__ */ Jo(Ei, n)), e.ipv6 = (n) => e.check(/* @__PURE__ */ Bo(bi, n)), e.cidrv4 = (n) => e.check(/* @__PURE__ */ Vo(Ti, n)), e.cidrv6 = (n) => e.check(/* @__PURE__ */ Xo(Si, n)), e.e164 = (n) => e.check(/* @__PURE__ */ qo(zi, n)), e.datetime = (n) => e.check(Js(n)), e.date = (n) => e.check(Vs(n)), e.time = (n) => e.check(Hs(n)), e.duration = (n) => e.check(qs(n));
});
function p(e) {
  return /* @__PURE__ */ Ro(di, e);
}
const S = /* @__PURE__ */ u("ZodStringFormat", (e, t) => {
  T.init(e, t), an.init(e, t);
}), pi = /* @__PURE__ */ u("ZodEmail", (e, t) => {
  Ur.init(e, t), S.init(e, t);
}), mt = /* @__PURE__ */ u("ZodGUID", (e, t) => {
  Dr.init(e, t), S.init(e, t);
}), pe = /* @__PURE__ */ u("ZodUUID", (e, t) => {
  xr.init(e, t), S.init(e, t);
}), fi = /* @__PURE__ */ u("ZodURL", (e, t) => {
  Mr.init(e, t), S.init(e, t);
}), hi = /* @__PURE__ */ u("ZodEmoji", (e, t) => {
  Fr.init(e, t), S.init(e, t);
}), mi = /* @__PURE__ */ u("ZodNanoID", (e, t) => {
  jr.init(e, t), S.init(e, t);
}), gi = /* @__PURE__ */ u("ZodCUID", (e, t) => {
  Gr.init(e, t), S.init(e, t);
}), _i = /* @__PURE__ */ u("ZodCUID2", (e, t) => {
  Wr.init(e, t), S.init(e, t);
}), vi = /* @__PURE__ */ u("ZodULID", (e, t) => {
  Jr.init(e, t), S.init(e, t);
}), yi = /* @__PURE__ */ u("ZodXID", (e, t) => {
  Br.init(e, t), S.init(e, t);
}), wi = /* @__PURE__ */ u("ZodKSUID", (e, t) => {
  Vr.init(e, t), S.init(e, t);
}), Ei = /* @__PURE__ */ u("ZodIPv4", (e, t) => {
  Yr.init(e, t), S.init(e, t);
}), bi = /* @__PURE__ */ u("ZodIPv6", (e, t) => {
  Qr.init(e, t), S.init(e, t);
}), Ti = /* @__PURE__ */ u("ZodCIDRv4", (e, t) => {
  eo.init(e, t), S.init(e, t);
}), Si = /* @__PURE__ */ u("ZodCIDRv6", (e, t) => {
  to.init(e, t), S.init(e, t);
}), ki = /* @__PURE__ */ u("ZodBase64", (e, t) => {
  no.init(e, t), S.init(e, t);
}), Oi = /* @__PURE__ */ u("ZodBase64URL", (e, t) => {
  oo.init(e, t), S.init(e, t);
}), zi = /* @__PURE__ */ u("ZodE164", (e, t) => {
  so.init(e, t), S.init(e, t);
}), Ni = /* @__PURE__ */ u("ZodJWT", (e, t) => {
  co.init(e, t), S.init(e, t);
}), un = /* @__PURE__ */ u("ZodNumber", (e, t) => {
  qt.init(e, t), z.init(e, t), e._zod.processJSONSchema = (r, o, i) => Os(e, r, o), ue(e, "ZodNumber", {
    gt(r, o) {
      return this.check(/* @__PURE__ */ pt(r, o));
    },
    gte(r, o) {
      return this.check(/* @__PURE__ */ Ne(r, o));
    },
    min(r, o) {
      return this.check(/* @__PURE__ */ Ne(r, o));
    },
    lt(r, o) {
      return this.check(/* @__PURE__ */ dt(r, o));
    },
    lte(r, o) {
      return this.check(/* @__PURE__ */ ze(r, o));
    },
    max(r, o) {
      return this.check(/* @__PURE__ */ ze(r, o));
    },
    int(r) {
      return this.check(gt(r));
    },
    safe(r) {
      return this.check(gt(r));
    },
    positive(r) {
      return this.check(/* @__PURE__ */ pt(0, r));
    },
    nonnegative(r) {
      return this.check(/* @__PURE__ */ Ne(0, r));
    },
    negative(r) {
      return this.check(/* @__PURE__ */ dt(0, r));
    },
    nonpositive(r) {
      return this.check(/* @__PURE__ */ ze(0, r));
    },
    multipleOf(r, o) {
      return this.check(/* @__PURE__ */ ft(r, o));
    },
    step(r, o) {
      return this.check(/* @__PURE__ */ ft(r, o));
    },
    finite() {
      return this;
    }
  });
  const n = e._zod.bag;
  e.minValue = Math.max(n.minimum ?? Number.NEGATIVE_INFINITY, n.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null, e.maxValue = Math.min(n.maximum ?? Number.POSITIVE_INFINITY, n.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? 0.5), e.isFinite = !0, e.format = n.format ?? null;
});
function I(e) {
  return /* @__PURE__ */ rs(un, e);
}
const Ii = /* @__PURE__ */ u("ZodNumberFormat", (e, t) => {
  ao.init(e, t), un.init(e, t);
});
function gt(e) {
  return /* @__PURE__ */ os(Ii, e);
}
const $i = /* @__PURE__ */ u("ZodBoolean", (e, t) => {
  uo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => zs(e, n, r);
});
function Z(e) {
  return /* @__PURE__ */ ss($i, e);
}
const Ri = /* @__PURE__ */ u("ZodUnknown", (e, t) => {
  lo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Is();
});
function _t() {
  return /* @__PURE__ */ is(Ri);
}
const Ai = /* @__PURE__ */ u("ZodNever", (e, t) => {
  po.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ns(e, n, r);
});
function Ci(e) {
  return /* @__PURE__ */ cs(Ai, e);
}
const Pi = /* @__PURE__ */ u("ZodArray", (e, t) => {
  fo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Cs(e, n, r, o), e.element = t.element, ue(e, "ZodArray", {
    min(n, r) {
      return this.check(/* @__PURE__ */ ve(n, r));
    },
    nonempty(n) {
      return this.check(/* @__PURE__ */ ve(1, n));
    },
    max(n, r) {
      return this.check(/* @__PURE__ */ tn(n, r));
    },
    length(n, r) {
      return this.check(/* @__PURE__ */ nn(n, r));
    },
    unwrap() {
      return this.element;
    }
  });
});
function ln(e, t) {
  return /* @__PURE__ */ ys(Pi, e, t);
}
const Zi = /* @__PURE__ */ u("ZodObject", (e, t) => {
  mo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ps(e, n, r, o), b(e, "shape", () => t.shape), ue(e, "ZodObject", {
    keyof() {
      return X(Object.keys(this._zod.def.shape));
    },
    catchall(n) {
      return this.clone({ ...this._zod.def, catchall: n });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: _t() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: _t() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: Ci() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: void 0 });
    },
    extend(n) {
      return An(this, n);
    },
    safeExtend(n) {
      return Cn(this, n);
    },
    merge(n) {
      return Pn(this, n);
    },
    pick(n) {
      return $n(this, n);
    },
    omit(n) {
      return Rn(this, n);
    },
    partial(...n) {
      return Zn(dn, this, n[0]);
    },
    required(...n) {
      return Ln(pn, this, n[0]);
    }
  });
});
function w(e, t) {
  const n = {
    type: "object",
    shape: e ?? {},
    ...f(t)
  };
  return new Zi(n);
}
const Li = /* @__PURE__ */ u("ZodUnion", (e, t) => {
  go.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Zs(e, n, r, o), e.options = t.options;
});
function Di(e, t) {
  return new Li({
    type: "union",
    options: e,
    ...f(t)
  });
}
const xi = /* @__PURE__ */ u("ZodIntersection", (e, t) => {
  _o.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ls(e, n, r, o);
});
function Ui(e, t) {
  return new xi({
    type: "intersection",
    left: e,
    right: t
  });
}
const Re = /* @__PURE__ */ u("ZodEnum", (e, t) => {
  vo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (r, o, i) => $s(e, r, o), e.enum = t.entries, e.options = Object.values(t.entries);
  const n = new Set(Object.keys(t.entries));
  e.extract = (r, o) => {
    const i = {};
    for (const s of r)
      if (n.has(s))
        i[s] = t.entries[s];
      else
        throw new Error(`Key ${s} not found in enum`);
    return new Re({
      ...t,
      checks: [],
      ...f(o),
      entries: i
    });
  }, e.exclude = (r, o) => {
    const i = { ...t.entries };
    for (const s of r)
      if (n.has(s))
        delete i[s];
      else
        throw new Error(`Key ${s} not found in enum`);
    return new Re({
      ...t,
      checks: [],
      ...f(o),
      entries: i
    });
  };
});
function X(e, t) {
  const n = Array.isArray(e) ? Object.fromEntries(e.map((r) => [r, r])) : e;
  return new Re({
    type: "enum",
    entries: n,
    ...f(t)
  });
}
const Mi = /* @__PURE__ */ u("ZodTransform", (e, t) => {
  yo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => As(e, n), e._zod.parse = (n, r) => {
    if (r.direction === "backward")
      throw new Lt(e.constructor.name);
    n.addIssue = (i) => {
      if (typeof i == "string")
        n.issues.push(ce(i, n.value, t));
      else {
        const s = i;
        s.fatal && (s.continue = !1), s.code ?? (s.code = "custom"), s.input ?? (s.input = n.value), s.inst ?? (s.inst = e), n.issues.push(ce(s));
      }
    };
    const o = t.transform(n.value, n);
    return o instanceof Promise ? o.then((i) => (n.value = i, n.fallback = !0, n)) : (n.value = o, n.fallback = !0, n);
  };
});
function Fi(e) {
  return new Mi({
    type: "transform",
    transform: e
  });
}
const dn = /* @__PURE__ */ u("ZodOptional", (e, t) => {
  en.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => cn(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function vt(e) {
  return new dn({
    type: "optional",
    innerType: e
  });
}
const ji = /* @__PURE__ */ u("ZodExactOptional", (e, t) => {
  wo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => cn(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Gi(e) {
  return new ji({
    type: "optional",
    innerType: e
  });
}
const Wi = /* @__PURE__ */ u("ZodNullable", (e, t) => {
  Eo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ds(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function yt(e) {
  return new Wi({
    type: "nullable",
    innerType: e
  });
}
const Ji = /* @__PURE__ */ u("ZodDefault", (e, t) => {
  bo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Us(e, n, r, o), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function Bi(e, t) {
  return new Ji({
    type: "default",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : Ut(t);
    }
  });
}
const Vi = /* @__PURE__ */ u("ZodPrefault", (e, t) => {
  To.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Ms(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Xi(e, t) {
  return new Vi({
    type: "prefault",
    innerType: e,
    get defaultValue() {
      return typeof t == "function" ? t() : Ut(t);
    }
  });
}
const pn = /* @__PURE__ */ u("ZodNonOptional", (e, t) => {
  So.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => xs(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function Hi(e, t) {
  return new pn({
    type: "nonoptional",
    innerType: e,
    ...f(t)
  });
}
const Ki = /* @__PURE__ */ u("ZodCatch", (e, t) => {
  ko.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Fs(e, n, r, o), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function qi(e, t) {
  return new Ki({
    type: "catch",
    innerType: e,
    catchValue: typeof t == "function" ? t : () => t
  });
}
const Yi = /* @__PURE__ */ u("ZodPipe", (e, t) => {
  Oo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => js(e, n, r, o), e.in = t.in, e.out = t.out;
});
function wt(e, t) {
  return new Yi({
    type: "pipe",
    in: e,
    out: t
    // ...util.normalizeParams(params),
  });
}
const Qi = /* @__PURE__ */ u("ZodReadonly", (e, t) => {
  zo.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Gs(e, n, r, o), e.unwrap = () => e._zod.def.innerType;
});
function ec(e) {
  return new Qi({
    type: "readonly",
    innerType: e
  });
}
const tc = /* @__PURE__ */ u("ZodCustom", (e, t) => {
  No.init(e, t), z.init(e, t), e._zod.processJSONSchema = (n, r, o) => Rs(e, n);
});
function nc(e, t = {}) {
  return /* @__PURE__ */ ws(tc, e, t);
}
function rc(e, t) {
  return /* @__PURE__ */ Es(e, t);
}
const Ae = /^(mongodb(?:\+srv)?):\/\//i;
function ae(e) {
  if (!Ae.test(e)) return Ce(e);
  const t = e.replace(/^(mongodb(?:\+srv)?:\/\/)[^/@]*@/i, "$1<redacted>@");
  return Ce(t);
}
function Ce(e) {
  return e.replace(/(password|passwd|pwd|secret|token|aws_session_token)=([^\s&;]+)/gi, "$1=<redacted>").replace(/\/\/[^/\s:]+:[^@\s]+@/g, "//<redacted>:<redacted>@");
}
function Et(e) {
  if (!e.match(Ae))
    throw new Error(`Invalid MongoDB URI scheme: ${ae(e)}`);
  try {
    const n = new URL(e.replace(Ae, "http://"));
    if (n.username || n.password)
      throw new Error("URI contains credentials; store secrets via the secret vault instead.");
  } catch (n) {
    throw n instanceof TypeError ? new Error(`Invalid MongoDB URI: ${ae(e)}`) : n;
  }
}
function Pe(e) {
  if (typeof e == "string") return Ce(ae(e));
  if (Array.isArray(e)) return e.map(Pe);
  if (e && typeof e == "object") {
    const t = {};
    for (const [n, r] of Object.entries(e))
      t[n] = /password|secret|token|credential|passphrase/i.test(n) ? "<redacted>" : Pe(r);
    return t;
  }
  return e;
}
const bt = (e, t) => Array.isArray(e.errorLabels) && e.errorLabels.includes(t);
function oc(e, t) {
  if (cc(e))
    return ac(e);
  const n = e ?? {}, r = typeof n.name == "string" ? n.name : "Error", o = typeof n.message == "string" ? n.message : String(e), s = {
    category: "Unknown",
    message: oe(o),
    name: r,
    ...typeof n.code == "number" ? { code: n.code } : {},
    ...typeof n.codeName == "string" ? { codeName: n.codeName } : {},
    ...Array.isArray(n.errorLabels) ? { labels: [...n.errorLabels] } : {},
    ...n.cause?.message ? { causeMessage: oe(n.cause.message) } : {}
  };
  if (r === "AbortError" || r === "MongoGCancelled")
    return { ...s, category: "Cancellation" };
  if (r === "ModuleNotAllowed")
    return { ...s, category: "ModuleNotAllowed" };
  switch (r) {
    case "MongoParseError":
      return { ...s, category: "InvalidConnectionString" };
    case "MongoServerSelectionError":
      return { ...s, category: "ServerSelection", hint: ic(n) };
    case "MongoNetworkTimeoutError":
      return { ...s, category: "NetworkTimeout" };
    case "MongoNetworkError":
      return /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(o) ? { ...s, category: "Dns" } : /TLS|SSL|certificate|CERT_/i.test(o) ? { ...s, category: "Tls" } : /timed? ?out/i.test(o) ? { ...s, category: "NetworkTimeout" } : { ...s, category: "Network" };
    case "MongoBulkWriteError":
    case "MongoWriteConcernError":
    case "MongoServerError":
      return { ...s, category: sc(n) };
    case "MongoExpiredSessionError":
    case "MongoTransactionError":
      return { ...s, category: "MongoDBCommand" };
    case "MongoRuntimeError":
    case "MongoAPIError":
      return { ...s, category: "MongoDBCommand" };
    case "MongoCursorExhaustedError":
    case "MongoCursorInUseError":
      return { ...s, category: "CursorNotFound" };
  }
  return bt(n, "TransientTransactionError") || bt(n, "UnknownTransactionCommitResult") ? { ...s, category: "MongoDBCommand" } : r.startsWith("Mongo") ? { ...s, category: "MongoDBCommand" } : { ...s, category: "JavaScriptRuntime" };
}
function sc(e) {
  switch (e.code) {
    case 18:
    case 8e3:
      return "Authentication";
    case 13:
    case 31:
      return "Authorization";
    case 11e3:
    case 11001:
    case 12582:
      return "DuplicateKey";
    case 121:
      return "Validation";
    case 50:
      return "NetworkTimeout";
    // ExceededTimeLimit (maxTimeMS)
    case 26:
    case 48:
      return "NotFound";
    // NamespaceNotFound / NamespaceExists-adjacent
    default:
      return "MongoDBCommand";
  }
}
function ic(e) {
  const t = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(t)) return "DNS resolution failed; check hostnames / SRV record.";
  if (/ECONNREFUSED/i.test(t)) return "Connection refused; is mongod running and reachable?";
  if (/certificate|TLS|SSL/i.test(t)) return "TLS handshake failed; check CA/cert options.";
  if (/Authentication/i.test(t)) return "Authentication failed during server selection.";
}
function cc(e) {
  return typeof e == "object" && e !== null && "category" in e && "message" in e && typeof e.message == "string";
}
function Se(e, t) {
  return oc(e);
}
function oe(e) {
  const t = Pe(e);
  return typeof t == "string" ? t : String(t);
}
function ac(e) {
  const t = oe(e.message), n = e.causeMessage === void 0 ? void 0 : oe(e.causeMessage), r = e.hint === void 0 ? void 0 : oe(e.hint);
  return t === e.message && n === e.causeMessage && r === e.hint ? e : {
    ...e,
    message: t,
    ...n === void 0 ? {} : { causeMessage: n },
    ...r === void 0 ? {} : { hint: r }
  };
}
function g(e, t, n) {
  return { category: e, message: t, ...n };
}
const Tt = /* @__PURE__ */ new Set();
function v(e, t, n, r) {
  if (Tt.has(e)) throw new Error(`Duplicate IPC channel: ${e}`);
  Tt.add(e), wn.handle(e, async (o, i) => {
    try {
      if (!r(o))
        return { ok: !1, error: g("Unknown", "IPC sender rejected.") };
      const s = t.safeParse(i ?? {});
      return s.success ? { ok: !0, value: await n(s.data, o) } : {
        ok: !1,
        error: g("Unknown", `Invalid IPC payload for ${e}`, {
          causeMessage: s.error.issues.map((a) => `${a.path.join(".")}: ${a.message}`).join("; ")
        })
      };
    } catch (s) {
      return { ok: !1, error: Se(s) };
    }
  });
}
const y = {
  spikePingRuntime: "mongog:spike:ping-runtime",
  spikeMongoUri: "mongog:spike:mongo-uri",
  spikeExecute: "mongog:spike:execute",
  cursorFetchNext: "mongog:cursor:fetch-next",
  cursorClose: "mongog:cursor:close",
  executionCancel: "mongog:execution:cancel",
  systemInfo: "mongog:system:info",
  // ── Phase 1: Connection Management ──
  connListGroups: "mongog:conn:list-groups",
  connCreateGroup: "mongog:conn:create-group",
  connUpdateGroup: "mongog:conn:update-group",
  connDeleteGroup: "mongog:conn:delete-group",
  connListProfiles: "mongog:conn:list-profiles",
  connGetProfile: "mongog:conn:get-profile",
  connCreateProfile: "mongog:conn:create-profile",
  connUpdateProfile: "mongog:conn:update-profile",
  connDeleteProfile: "mongog:conn:delete-profile",
  connConnect: "mongog:conn:connect",
  connDisconnect: "mongog:conn:disconnect",
  connGetState: "mongog:conn:get-state",
  connListConnected: "mongog:conn:list-connected",
  connTest: "mongog:conn:test",
  // ── Phase 2: Query execution ──
  connExecute: "mongog:conn:execute",
  connCursorFetchNext: "mongog:conn:cursor:fetch-next",
  connCursorClose: "mongog:conn:cursor:close",
  connExecutionCancel: "mongog:conn:execution:cancel",
  connListDatabases: "mongog:conn:list-databases",
  connListCollections: "mongog:conn:list-collections",
  // ── Phase 4: Schema / completions ──
  connSampleSchema: "mongog:conn:sample-schema",
  // ── Workspace persistence ──
  workspaceSave: "mongog:workspace:save",
  workspaceLoad: "mongog:workspace:load"
}, K = {
  engine: "mongog:event:engine",
  connectionState: "mongog:event:connection-state"
}, uc = w({
  connectionId: p().min(1),
  database: p().min(1),
  mode: X(["query", "trusted"]),
  source: p().max(2 * 1024 * 1024),
  sourceOffset: w({ line: I().int().min(0), column: I().int().min(0) }),
  readOnly: Z().optional(),
  pageSize: I().int().min(1).max(500).optional(),
  timeoutMS: I().int().min(0).max(6e5).optional()
}), lc = w({
  cursorId: p().min(1),
  pageSize: I().int().min(1).max(500).optional()
}), dc = w({ cursorId: p().min(1) }), pc = w({ executionId: p().min(1) }), Ge = w({
  connectTimeoutMS: I().int().min(0).optional(),
  serverSelectionTimeoutMS: I().int().min(0).optional(),
  socketTimeoutMS: I().int().min(0).optional(),
  timeoutMS: I().int().min(0).optional(),
  maxPoolSize: I().int().min(1).optional(),
  minPoolSize: I().int().min(0).optional(),
  readPreference: X(["primary", "primaryPreferred", "secondary", "secondaryPreferred", "nearest"]).optional(),
  retryReads: Z().optional(),
  retryWrites: Z().optional(),
  directConnection: Z().optional(),
  appName: p().optional(),
  authMechanism: X(["SCRAM", "MONGODB-X509", "MONGODB-AWS", "MONGODB-OIDC"]).optional(),
  authSource: p().optional(),
  username: p().optional(),
  tls: w({ enabled: Z(), allowInvalidCertificates: Z().optional() }).optional()
}), fn = w({
  password: p().optional(),
  uriOverride: p().optional(),
  awsAccessKeyId: p().optional(),
  awsSecretAccessKey: p().optional(),
  awsSessionToken: p().optional(),
  tlsCertificateKeyFilePassphrase: p().optional()
}), fc = w({ name: p().min(1).max(200) }), hc = w({
  id: p().min(1),
  name: p().min(1).max(200),
  collapsed: Z(),
  sortOrder: I().int().min(0)
}), mc = w({ id: p().min(1) }), gc = w({
  name: p().min(1).max(200),
  groupId: p().nullable().optional(),
  uri: p().min(1),
  defaultDatabase: p().optional(),
  readOnly: Z().optional(),
  options: Ge.optional(),
  color: p().optional(),
  secret: fn.optional()
}), _c = w({
  id: p().min(1),
  name: p().min(1).max(200).optional(),
  groupId: p().nullable().optional(),
  uri: p().optional(),
  defaultDatabase: p().nullable().optional(),
  readOnly: Z().optional(),
  options: Ge.optional(),
  color: p().nullable().optional(),
  secret: fn.nullable().optional()
}), vc = w({ id: p().min(1) }), yc = w({ profileId: p().min(1) }), wc = w({ profileId: p().min(1) }), St = w({ profileId: p().min(1) }), Ec = w({
  uri: p().min(1),
  options: Ge.optional()
}), bc = w({
  connectionId: p().min(1),
  database: p().min(1),
  collection: p().min(1),
  sampleSize: I().int().min(1).max(5e3).optional()
}), Tc = w({
  state: w({
    tabs: ln(w({
      id: p(),
      kind: X(["query", "collection", "history", "connection-settings"]),
      title: p(),
      connectionId: p().nullable(),
      database: p().optional(),
      collection: p().optional(),
      editorContent: p().optional(),
      mode: X(["query", "trusted"]).optional(),
      profileId: p().optional(),
      dirty: Z().optional()
    })),
    activeTabId: p().nullable()
  })
}), Sc = w({
  connectionId: p().min(1),
  database: p().min(1),
  mode: X(["query", "trusted"]),
  source: p().max(2 * 1024 * 1024),
  sourceOffset: w({ line: I().int().min(0), column: I().int().min(0) }),
  readOnly: Z().optional(),
  pageSize: I().int().min(1).max(500).optional(),
  timeoutMS: I().int().min(0).max(6e5).optional()
}), kc = w({
  connectionId: p().min(1),
  cursorId: p().min(1),
  pageSize: I().int().min(1).max(500).optional()
}), Oc = w({
  connectionId: p().min(1),
  cursorId: p().min(1)
}), zc = w({
  connectionId: p().min(1),
  executionId: p().min(1)
}), Nc = w({
  connectionId: p().min(1)
}), Ic = w({
  connectionId: p().min(1),
  database: p().min(1)
}), $c = 12e4;
class We extends Pt {
  child = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  requestTimeoutMS;
  connectionId;
  entryPath;
  exitInfo = null;
  constructor(t) {
    super(), this.entryPath = t.entryPath, this.connectionId = t.connectionId, this.requestTimeoutMS = t.requestTimeoutMS ?? $c;
  }
  get pid() {
    return this.child?.pid;
  }
  get isAlive() {
    return this.child !== null && this.exitInfo === null;
  }
  async start() {
    this.child && this.isAlive || (this.exitInfo = null, this.child = En.fork(this.entryPath, [], {
      serviceName: `MongoG Query Runtime (${this.connectionId})`,
      stdio: "pipe",
      // Scrubbed environment: do not leak app/keychain env into the runtime.
      env: { ...Rc(process.env) }
    }), this.child.stdout?.on("data", (t) => this.emit("log", "stdout", String(t))), this.child.stderr?.on("data", (t) => this.emit("log", "stderr", String(t))), this.child.on("message", (t) => this.onMessage(t)), this.child.on("exit", (t) => this.onExit(t)), await new Promise((t, n) => {
      const r = () => {
        i(), t();
      }, o = (s) => {
        i(), n(g("UtilityProcessCrash", `Query runtime exited during spawn (code ${s}).`));
      }, i = () => {
        this.child?.off("spawn", r), this.child?.off("exit", o);
      };
      this.child.once("spawn", r), this.child.once("exit", o);
    }));
  }
  async request(t, n = {}) {
    if (!this.child || !this.isAlive)
      throw g("UtilityProcessCrash", "Query runtime is not running.");
    const r = this.nextId++;
    return new Promise((o, i) => {
      const s = setTimeout(() => {
        this.pending.delete(r), i(g("NetworkTimeout", `Runtime request "${t}" timed out.`));
      }, this.requestTimeoutMS);
      s.unref?.(), this.pending.set(r, {
        resolve: (c) => o(c),
        reject: i,
        timer: s
      }), this.child.postMessage({ id: r, type: t, ...n });
    });
  }
  onEngineEvent(t) {
    this.on("engine-event", t);
  }
  async kill() {
    const t = this.child;
    if (t) {
      this.child = null;
      for (const [, n] of this.pending)
        clearTimeout(n.timer), n.reject(g("UtilityProcessCrash", "Query runtime was killed."));
      this.pending.clear(), t.kill();
    }
  }
  onMessage(t) {
    const n = t;
    if (n.type === "engine-event" && n.executionId && n.event) {
      this.emit("engine-event", n.executionId, n.event);
      return;
    }
    if (n.type === "ready") {
      this.emit("ready", n);
      return;
    }
    if (n.type === "runtime-error") {
      this.emit("runtime-error", n.error);
      return;
    }
    if (typeof n.id == "number") {
      const r = this.pending.get(n.id);
      if (!r) return;
      this.pending.delete(n.id), clearTimeout(r.timer), n.ok ? r.resolve(n.value) : r.reject(n.error ?? g("Unknown", "Runtime request failed."));
    }
  }
  onExit(t) {
    this.exitInfo = { code: t, at: Date.now() };
    const n = g("UtilityProcessCrash", `Query runtime exited (code ${t}).`);
    for (const [, r] of this.pending)
      clearTimeout(r.timer), r.reject(n);
    this.pending.clear(), this.emit("exit", t);
  }
}
function Rc(e) {
  const t = {};
  for (const [n, r] of Object.entries(e))
    r !== void 0 && (/^MONGOG_/i.test(n) || /KEYCHAIN|TOKEN|SECRET|PASSWORD/i.test(n) || n !== "ELECTRON_RUN_AS_NODE" && n !== "NODE_OPTIONS" && (t[n] = r));
  return t;
}
F.dirname(Ct(import.meta.url));
function Je() {
  const e = F.join(j.getAppPath(), "runtime-dist", "query-runtime.cjs");
  return j.isPackaged ? e.replace(`${F.sep}app.asar${F.sep}`, `${F.sep}app.asar.unpacked${F.sep}`) : e;
}
class Ac {
  db;
  supervisor;
  secrets;
  constructor(t, n, r) {
    this.db = t, this.supervisor = n, this.secrets = r;
  }
  // ── Groups ──
  listGroups() {
    return this.db.groups.list();
  }
  createGroup(t) {
    const n = {
      id: Oe(),
      name: t,
      collapsed: !1,
      sortOrder: this.db.groups.count(),
      createdAt: Date.now()
    };
    return this.db.groups.insert(n), n;
  }
  updateGroup(t) {
    this.db.groups.update(t);
  }
  deleteGroup(t) {
    this.db.groups.remove(t);
  }
  // ── Profiles ──
  listProfiles() {
    return this.db.profiles.list();
  }
  getProfile(t) {
    return this.db.profiles.byId(t);
  }
  async createProfile(t) {
    Et(t.uri);
    const n = {
      id: Oe(),
      groupId: t.groupId ?? null,
      name: t.name,
      color: t.color ?? null,
      uriRedacted: ae(t.uri),
      defaultDatabase: t.defaultDatabase ?? null,
      readOnly: t.readOnly ?? !1,
      options: t.options ?? {},
      hasSecret: t.secret !== void 0 && Object.keys(t.secret).length > 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    n.hasSecret && t.secret && await this.secrets.set(x(n.id), JSON.stringify(t.secret));
    try {
      return this.db.profiles.insert(n), n;
    } catch (r) {
      throw n.hasSecret && await this.secrets.clear(x(n.id)).catch(() => {
      }), r;
    }
  }
  async updateProfile(t, n) {
    const r = this.db.profiles.byId(t);
    if (!r) throw g("NotFound", `Connection profile not found: ${t}`);
    n.uri !== void 0 && Et(n.uri);
    const o = {
      ...r,
      name: n.name ?? r.name,
      groupId: n.groupId !== void 0 ? n.groupId : r.groupId,
      color: n.color !== void 0 ? n.color : r.color,
      uriRedacted: n.uri !== void 0 ? ae(n.uri) : r.uriRedacted,
      defaultDatabase: n.defaultDatabase !== void 0 ? n.defaultDatabase : r.defaultDatabase,
      readOnly: n.readOnly ?? r.readOnly,
      options: n.options ?? r.options,
      updatedAt: Date.now()
    };
    let i;
    if (n.secret !== void 0) {
      i = await this.secrets.get(x(t));
      const s = n.secret !== null && Object.keys(n.secret).length > 0;
      o.hasSecret = s, s && n.secret ? await this.secrets.set(x(t), JSON.stringify(n.secret)) : await this.secrets.clear(x(t));
    }
    try {
      return this.db.profiles.update(o), o;
    } catch (s) {
      throw i !== void 0 && (i === null ? await this.secrets.clear(x(t)).catch(() => {
      }) : await this.secrets.set(x(t), i).catch(() => {
      })), s;
    }
  }
  async deleteProfile(t) {
    await this.supervisor.dispose(t).catch(() => {
    }), await this.secrets.clear(x(t)), this.db.profiles.remove(t);
  }
  // ── Connectivity ──
  async resolveUri(t) {
    const n = this.db.profiles.byId(t);
    if (!n) throw g("NotFound", `Connection profile not found: ${t}`);
    if (!n.hasSecret) return n.uriRedacted;
    const r = await this.secrets.get(x(t));
    if (!r) return n.uriRedacted;
    let o;
    try {
      o = JSON.parse(r);
    } catch {
      throw g("SecureStorageFailure", "Stored connection secret is invalid and must be entered again.");
    }
    if (o.uriOverride) return o.uriOverride;
    if (o.password) {
      const i = n.options.username, s = i ? `${encodeURIComponent(i)}:${encodeURIComponent(o.password)}` : encodeURIComponent(o.password);
      return n.uriRedacted.replace("//", `//${s}@`);
    }
    return n.uriRedacted;
  }
  async connect(t) {
    const n = this.db.profiles.byId(t);
    if (!n) throw g("NotFound", `Connection profile not found: ${t}`);
    const r = await this.resolveUri(t), { username: o, ...i } = n.options ?? {};
    await this.supervisor.ensure(t, r, i);
  }
  async disconnect(t) {
    await this.supervisor.dispose(t);
  }
  getConnectionState(t) {
    const n = this.supervisor.getInfo(t);
    return n ? {
      status: "connected",
      pid: n.pid,
      serverVersion: n.serverVersion,
      connectedAt: n.connectedAt
    } : { status: "disconnected" };
  }
  listConnected() {
    return this.db.profiles.list().filter((t) => this.supervisor.getInfo(t.id) !== null).map((t) => t.id);
  }
  async testConnection(t, n) {
    const r = new We({
      entryPath: Je(),
      connectionId: `test-${Oe()}`,
      requestTimeoutMS: 15e3
    });
    try {
      await r.start();
      const o = Date.now(), i = await r.request("init", {
        uri: t,
        options: n ?? {}
      }), s = Date.now() - o;
      return await r.request("ping"), {
        ok: !0,
        serverVersion: i.serverVersion,
        topology: i.topology,
        roundTripMs: s
      };
    } catch (o) {
      return { ok: !1, error: Se(o) };
    } finally {
      await r.kill();
    }
  }
}
function x(e) {
  return `conn:${e}`;
}
const J = w({}).strict(), fe = "spike";
function Cc(e, t) {
  const { supervisor: n } = e, r = new Ac(e.getDb(), n, e.secretStore);
  v(
    y.spikePingRuntime,
    J,
    async () => {
      const o = Date.now(), i = new We({
        entryPath: Je(),
        connectionId: "spike-ping"
      });
      try {
        return await i.start(), { pong: !0, runtimePid: (await i.request("ping")).pid, roundTripMs: Date.now() - o };
      } finally {
        await i.kill();
      }
    },
    t
  ), v(y.spikeMongoUri, J, async () => e.getSpikeMongoUri(), t), v(
    y.spikeExecute,
    uc,
    async (o) => {
      const i = await e.getSpikeMongoUri();
      if (!i)
        throw g("InvalidConnectionString", "No spike MongoDB available. Start with MONGOG_SPIKE_MONGO=1.");
      return (await n.ensure(fe, i)).request("execute", { request: o });
    },
    t
  ), v(
    y.cursorFetchNext,
    lc,
    async ({ cursorId: o, pageSize: i }) => {
      const s = n.get(fe);
      if (!s) throw g("UtilityProcessCrash", "Query runtime is not running.");
      return s.request("cursor-next", { cursorId: o, pageSize: i });
    },
    t
  ), v(
    y.cursorClose,
    dc,
    async ({ cursorId: o }) => {
      const i = n.get(fe);
      i && await i.request("cursor-close", { cursorId: o });
    },
    t
  ), v(
    y.executionCancel,
    pc,
    async ({ executionId: o }) => {
      const i = n.get(fe);
      i && await i.request("cancel", { executionId: o });
    },
    t
  ), v(
    y.systemInfo,
    J,
    async () => ({
      appVersion: process.env.npm_package_version ?? "0.0.1",
      electron: process.versions.electron ?? "unknown",
      chrome: process.versions.chrome ?? "unknown",
      node: process.versions.node ?? "unknown",
      platform: process.platform
    }),
    t
  ), v(y.connListGroups, J, async () => r.listGroups(), t), v(y.connCreateGroup, fc, async ({ name: o }) => r.createGroup(o), t), v(y.connUpdateGroup, hc, async (o) => {
    const i = r.listGroups().find((s) => s.id === o.id);
    if (!i) throw g("NotFound", `Group not found: ${o.id}`);
    r.updateGroup({ ...i, name: o.name, collapsed: o.collapsed, sortOrder: o.sortOrder });
  }, t), v(y.connDeleteGroup, mc, async ({ id: o }) => r.deleteGroup(o), t), v(y.connListProfiles, J, async () => r.listProfiles(), t), v(y.connGetProfile, St, async ({ profileId: o }) => r.getProfile(o), t), v(y.connCreateProfile, gc, async (o) => r.createProfile({ ...o, groupId: o.groupId ?? null }), t), v(y.connUpdateProfile, _c, async ({ id: o, ...i }) => r.updateProfile(o, i), t), v(y.connDeleteProfile, vc, async ({ id: o }) => r.deleteProfile(o), t), v(y.connConnect, yc, async ({ profileId: o }) => r.connect(o), t), v(y.connDisconnect, wc, async ({ profileId: o }) => r.disconnect(o), t), v(y.connGetState, St, async ({ profileId: o }) => r.getConnectionState(o), t), v(y.connListConnected, J, async () => r.listConnected(), t), v(y.connTest, Ec, async ({ uri: o, options: i }) => r.testConnection(o, i), t), v(y.connExecute, Sc, async (o) => {
    const i = n.get(o.connectionId);
    if (!i) throw g("UtilityProcessCrash", `Connection ${o.connectionId} is not running.`);
    return i.request("execute", { request: o });
  }, t), v(y.connCursorFetchNext, kc, async ({ connectionId: o, cursorId: i, pageSize: s }) => {
    const c = n.get(o);
    if (!c) throw g("UtilityProcessCrash", "Query runtime is not running.");
    return c.request("cursor-next", { cursorId: i, pageSize: s });
  }, t), v(y.connCursorClose, Oc, async ({ connectionId: o, cursorId: i }) => {
    const s = n.get(o);
    s && await s.request("cursor-close", { cursorId: i });
  }, t), v(y.connExecutionCancel, zc, async ({ connectionId: o, executionId: i }) => {
    const s = n.get(o);
    s && await s.request("cancel", { executionId: i });
  }, t), v(y.connListDatabases, Nc, async ({ connectionId: o }) => {
    const i = n.get(o);
    if (!i) throw g("UtilityProcessCrash", `Connection ${o} is not running.`);
    return i.request("list-databases");
  }, t), v(y.connListCollections, Ic, async ({ connectionId: o, database: i }) => {
    const s = n.get(o);
    if (!s) throw g("UtilityProcessCrash", `Connection ${o} is not running.`);
    return s.request("list-collections", { database: i });
  }, t), v(y.connSampleSchema, bc, async ({ connectionId: o, database: i, collection: s, sampleSize: c }) => {
    const a = n.get(o);
    if (!a) throw g("UtilityProcessCrash", `Connection ${o} is not running.`);
    return a.request("sample-schema", { database: i, collection: s, ...c !== void 0 ? { sampleSize: c } : {} });
  }, t), v(y.workspaceSave, Tc, async ({ state: o }) => {
    e.getDb().workspace.upsert({
      version: 1,
      sidebarWidth: 260,
      expandedNodeKeys: [],
      tabs: o.tabs,
      activeTabId: o.activeTabId
    });
  }, t), v(y.workspaceLoad, J, async () => {
    const o = e.getDb().workspace.get();
    return o ? { tabs: o.tabs, activeTabId: o.activeTabId } : null;
  }, t);
}
const kt = { maxRuntimes: 10, idleTimeoutMS: 900 * 1e3 };
class Pc extends Pt {
  runtimes = /* @__PURE__ */ new Map();
  maxRuntimes;
  idleTimeoutMS;
  sweeper = null;
  constructor(t = {}) {
    super(), this.maxRuntimes = t.maxRuntimes ?? kt.maxRuntimes, this.idleTimeoutMS = t.idleTimeoutMS ?? kt.idleTimeoutMS;
  }
  startSweeper(t = 6e4) {
    this.sweeper || (this.sweeper = setInterval(() => {
      this.evictIdle();
    }, t), this.sweeper.unref?.());
  }
  get size() {
    return this.runtimes.size;
  }
  async ensure(t, n, r = {}) {
    const o = this.runtimes.get(t);
    if (o?.client.isAlive)
      return o.lastUsedAt = Date.now(), o.client;
    if (o && await this.dispose(t), this.runtimes.size >= this.maxRuntimes)
      throw g(
        "Unknown",
        `Maximum active runtimes (${this.maxRuntimes}) reached. Disconnect a connection first.`,
        { hint: "Raise execution.maxRuntimes in settings if needed." }
      );
    const i = new We({ entryPath: Je(), connectionId: t });
    i.onEngineEvent((a, l) => {
      this.emit("engine-event", t, a, l);
    }), i.on("exit", () => {
      this.runtimes.get(t)?.client === i && (this.runtimes.delete(t), this.emit("runtime-exit", t));
    }), this.emit("runtime-connecting", t);
    let s;
    try {
      await i.start(), s = await i.request("init", {
        uri: n,
        options: r
      });
    } catch (a) {
      throw await i.kill().catch(() => {
      }), this.emit("runtime-connect-error", t, Se(a)), a;
    }
    const c = Date.now();
    return this.runtimes.set(t, {
      client: i,
      lastUsedAt: c,
      connectedAt: c,
      serverVersion: s.serverVersion,
      uri: n,
      options: r
    }), this.emit("runtime-ready", t, { ...s, connectedAt: c }), i;
  }
  touch(t) {
    const n = this.runtimes.get(t);
    n && (n.lastUsedAt = Date.now());
  }
  get(t) {
    const n = this.runtimes.get(t);
    return n?.client.isAlive ? (n.lastUsedAt = Date.now(), n.client) : null;
  }
  getInfo(t) {
    const n = this.runtimes.get(t);
    return n?.client.isAlive ? {
      pid: n.client.pid,
      serverVersion: n.serverVersion,
      connectedAt: n.connectedAt
    } : null;
  }
  async dispose(t) {
    const n = this.runtimes.get(t);
    this.runtimes.delete(t), n && await n.client.kill();
  }
  async disposeAll() {
    this.sweeper && clearInterval(this.sweeper), this.sweeper = null, await Promise.all([...this.runtimes.keys()].map((t) => this.dispose(t)));
  }
  async evictIdle() {
    const t = Date.now();
    for (const [n, r] of [...this.runtimes.entries()])
      t - r.lastUsedAt > this.idleTimeoutMS && (await this.dispose(n), this.emit("runtime-idle-evicted", n));
  }
}
const Zc = [
  {
    version: 1,
    description: "Initial schema: connection profiles, groups, secrets, history, workspace, settings, scripts",
    up(e) {
      e.exec(`
        CREATE TABLE IF NOT EXISTS connection_groups (
          id          TEXT PRIMARY KEY NOT NULL,
          name        TEXT NOT NULL,
          collapsed   INTEGER NOT NULL DEFAULT 0,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS connection_profiles (
          id                TEXT PRIMARY KEY NOT NULL,
          group_id          TEXT REFERENCES connection_groups(id) ON DELETE SET NULL,
          name              TEXT NOT NULL,
          color             TEXT,
          uri_redacted      TEXT NOT NULL,
          default_database  TEXT,
          read_only         INTEGER NOT NULL DEFAULT 0,
          has_secret        INTEGER NOT NULL DEFAULT 0,
          options_json      TEXT NOT NULL DEFAULT '{}',
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS secrets (
          key         TEXT PRIMARY KEY NOT NULL,
          blob        BLOB NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_history (
          id              TEXT PRIMARY KEY NOT NULL,
          executed_at     INTEGER NOT NULL,
          connection_id   TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
          database        TEXT NOT NULL,
          script          TEXT NOT NULL,
          selection       TEXT,
          duration_ms     INTEGER NOT NULL,
          status          TEXT NOT NULL CHECK(status IN ('success','error','cancelled')),
          returned_count  INTEGER,
          modified_count  INTEGER,
          favourite       INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_history_connection ON query_history(connection_id);
        CREATE INDEX IF NOT EXISTS idx_history_executed  ON query_history(executed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_favourite  ON query_history(favourite) WHERE favourite = 1;

        CREATE TABLE IF NOT EXISTS workspace_state (
          id       TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
          state    TEXT NOT NULL,
          version  INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS settings (
          key    TEXT PRIMARY KEY NOT NULL,
          value  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_scripts (
          id              TEXT PRIMARY KEY NOT NULL,
          name            TEXT NOT NULL,
          folder          TEXT,
          tags_json       TEXT NOT NULL DEFAULT '[]',
          connection_id   TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
          database_name   TEXT,
          content         TEXT NOT NULL,
          language        TEXT NOT NULL DEFAULT 'javascript' CHECK(language IN ('javascript','typescript')),
          created_at      INTEGER NOT NULL,
          updated_at      INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scripts_folder ON saved_scripts(folder);
      `);
    }
  }
];
function Lc(e) {
  e.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version   INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const t = e.pragma("user_version", { simple: !0 }), n = new Set(
    e.prepare("SELECT version FROM _migrations").all().map((r) => r.version)
  );
  for (const r of Zc) {
    if (r.version <= t) continue;
    e.transaction(() => {
      r.up(e), n.has(r.version) || e.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(r.version, Date.now()), e.pragma(`user_version = ${r.version}`);
    })();
  }
}
function he(e) {
  return {
    id: e.id,
    groupId: e.group_id ?? null,
    name: e.name,
    color: e.color ?? null,
    uriRedacted: e.uri_redacted,
    defaultDatabase: e.default_database ?? null,
    readOnly: e.read_only === 1,
    options: JSON.parse(e.options_json),
    hasSecret: e.has_secret === 1,
    createdAt: e.created_at,
    updatedAt: e.updated_at
  };
}
class Dc {
  db;
  constructor(t) {
    this.db = t;
  }
  list() {
    return this.db.prepare("SELECT * FROM connection_profiles ORDER BY name ASC").all().map(he);
  }
  byId(t) {
    const n = this.db.prepare("SELECT * FROM connection_profiles WHERE id = ?").get(t);
    return n ? he(n) : null;
  }
  listByGroup(t) {
    return t === null ? this.db.prepare("SELECT * FROM connection_profiles WHERE group_id IS NULL ORDER BY name ASC").all().map(he) : this.db.prepare("SELECT * FROM connection_profiles WHERE group_id = ? ORDER BY name ASC").all(t).map(he);
  }
  insert(t) {
    try {
      this.db.prepare(
        `INSERT INTO connection_profiles
           (id, group_id, name, color, uri_redacted, default_database, read_only, has_secret, options_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        t.id,
        t.groupId,
        t.name,
        t.color,
        t.uriRedacted,
        t.defaultDatabase,
        t.readOnly ? 1 : 0,
        t.hasSecret ? 1 : 0,
        JSON.stringify(t.options),
        t.createdAt,
        t.updatedAt
      );
    } catch (n) {
      throw g("LocalPersistence", `Failed to insert profile: ${n.message}`);
    }
  }
  update(t) {
    try {
      this.db.prepare(
        `UPDATE connection_profiles SET
           group_id = ?, name = ?, color = ?, uri_redacted = ?, default_database = ?,
           read_only = ?, has_secret = ?, options_json = ?, updated_at = ?
           WHERE id = ?`
      ).run(
        t.groupId,
        t.name,
        t.color,
        t.uriRedacted,
        t.defaultDatabase,
        t.readOnly ? 1 : 0,
        t.hasSecret ? 1 : 0,
        JSON.stringify(t.options),
        t.updatedAt,
        t.id
      );
    } catch (n) {
      throw g("LocalPersistence", `Failed to update profile: ${n.message}`);
    }
  }
  remove(t) {
    try {
      this.db.prepare("DELETE FROM connection_profiles WHERE id = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to delete profile: ${n.message}`);
    }
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM connection_profiles").get().c;
  }
}
function Ot(e) {
  return {
    id: e.id,
    name: e.name,
    collapsed: e.collapsed === 1,
    sortOrder: e.sort_order,
    createdAt: e.created_at
  };
}
class xc {
  db;
  constructor(t) {
    this.db = t;
  }
  list() {
    return this.db.prepare("SELECT * FROM connection_groups ORDER BY sort_order ASC, name ASC").all().map(Ot);
  }
  byId(t) {
    const n = this.db.prepare("SELECT * FROM connection_groups WHERE id = ?").get(t);
    return n ? Ot(n) : null;
  }
  insert(t) {
    try {
      this.db.prepare(
        "INSERT INTO connection_groups (id, name, collapsed, sort_order, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(t.id, t.name, t.collapsed ? 1 : 0, t.sortOrder, t.createdAt);
    } catch (n) {
      throw g("LocalPersistence", `Failed to insert group: ${n.message}`);
    }
  }
  update(t) {
    try {
      this.db.prepare("UPDATE connection_groups SET name = ?, collapsed = ?, sort_order = ? WHERE id = ?").run(t.name, t.collapsed ? 1 : 0, t.sortOrder, t.id);
    } catch (n) {
      throw g("LocalPersistence", `Failed to update group: ${n.message}`);
    }
  }
  remove(t) {
    try {
      this.db.prepare("DELETE FROM connection_groups WHERE id = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to delete group: ${n.message}`);
    }
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM connection_groups").get().c;
  }
}
function zt(e) {
  return {
    id: e.id,
    executedAt: e.executed_at,
    connectionId: e.connection_id,
    database: e.database,
    script: e.script,
    selection: e.selection ?? void 0,
    durationMs: e.duration_ms,
    status: e.status,
    returnedCount: e.returned_count ?? void 0,
    modifiedCount: e.modified_count ?? void 0,
    favourite: e.favourite === 1
  };
}
class Uc {
  db;
  constructor(t) {
    this.db = t;
  }
  insert(t) {
    try {
      this.db.prepare(
        `INSERT INTO query_history
           (id, executed_at, connection_id, database, script, selection, duration_ms, status, returned_count, modified_count, favourite)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        t.id,
        t.executedAt,
        t.connectionId,
        t.database,
        t.script,
        t.selection ?? null,
        t.durationMs,
        t.status,
        t.returnedCount ?? null,
        t.modifiedCount ?? null,
        t.favourite ? 1 : 0
      );
    } catch (n) {
      throw g("LocalPersistence", `Failed to insert history: ${n.message}`);
    }
  }
  search(t) {
    const n = [], r = [];
    t.text && (n.push("script LIKE ?"), r.push(`%${t.text}%`)), t.connectionId && (n.push("connection_id = ?"), r.push(t.connectionId)), t.database && (n.push("database = ?"), r.push(t.database)), t.fromTs !== void 0 && (n.push("executed_at >= ?"), r.push(t.fromTs)), t.toTs !== void 0 && (n.push("executed_at <= ?"), r.push(t.toTs)), t.favouritesOnly && n.push("favourite = 1");
    const o = n.length > 0 ? `WHERE ${n.join(" AND ")}` : "", i = Math.min(t.limit ?? 100, 1e3), s = t.offset ?? 0, c = `SELECT * FROM query_history ${o} ORDER BY executed_at DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(c).all(...r, i, s).map(zt);
  }
  byId(t) {
    const n = this.db.prepare("SELECT * FROM query_history WHERE id = ?").get(t);
    return n ? zt(n) : null;
  }
  toggleFavourite(t) {
    try {
      this.db.prepare("UPDATE query_history SET favourite = CASE WHEN favourite = 1 THEN 0 ELSE 1 END WHERE id = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to toggle favourite: ${n.message}`);
    }
  }
  remove(t) {
    try {
      this.db.prepare("DELETE FROM query_history WHERE id = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to delete history: ${n.message}`);
    }
  }
  pruneOlderThan(t) {
    return this.db.prepare("DELETE FROM query_history WHERE executed_at < ?").run(t).changes;
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM query_history").get().c;
  }
}
class Mc {
  db;
  constructor(t) {
    this.db = t;
  }
  get(t = "default") {
    const n = this.db.prepare("SELECT state FROM workspace_state WHERE id = ?").get(t);
    if (!n) return null;
    try {
      return JSON.parse(n.state);
    } catch {
      return null;
    }
  }
  upsert(t, n = "default") {
    try {
      this.db.prepare(
        `INSERT INTO workspace_state (id, state, version) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, version = excluded.version`
      ).run(n, JSON.stringify(t), t.version);
    } catch (r) {
      throw g("LocalPersistence", `Failed to save workspace: ${r.message}`);
    }
  }
  remove(t = "default") {
    this.db.prepare("DELETE FROM workspace_state WHERE id = ?").run(t);
  }
}
class Fc {
  db;
  constructor(t) {
    this.db = t;
  }
  get() {
    const t = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
    if (!t) return null;
    try {
      return JSON.parse(t.value);
    } catch {
      return null;
    }
  }
  upsert(t) {
    try {
      this.db.prepare(
        `INSERT INTO settings (key, value) VALUES ('app', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(t));
    } catch (n) {
      throw g("LocalPersistence", `Failed to save settings: ${n.message}`);
    }
  }
  getRaw(t) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(t)?.value ?? null;
  }
  setRaw(t, n) {
    try {
      this.db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(t, n);
    } catch (r) {
      throw g("LocalPersistence", `Failed to set setting: ${r.message}`);
    }
  }
  remove(t) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(t);
  }
}
class jc {
  db;
  constructor(t) {
    this.db = t;
  }
  upsert(t, n) {
    try {
      const r = Date.now();
      this.db.prepare(
        `INSERT INTO secrets (key, blob, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`
      ).run(t, n, r, r);
    } catch (r) {
      throw g("LocalPersistence", `Failed to store secret: ${r.message}`);
    }
  }
  getBlob(t) {
    return this.db.prepare("SELECT blob FROM secrets WHERE key = ?").get(t)?.blob ?? null;
  }
  remove(t) {
    try {
      this.db.prepare("DELETE FROM secrets WHERE key = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to delete secret: ${n.message}`);
    }
  }
  has(t) {
    return this.db.prepare("SELECT 1 e FROM secrets WHERE key = ?").get(t) !== void 0;
  }
  allKeys() {
    return this.db.prepare("SELECT key FROM secrets").all().map((n) => n.key);
  }
}
function me(e) {
  return {
    id: e.id,
    name: e.name,
    folder: e.folder ?? null,
    tags: JSON.parse(e.tags_json),
    connectionId: e.connection_id ?? null,
    database: e.database_name ?? null,
    content: e.content,
    language: e.language,
    createdAt: e.created_at,
    updatedAt: e.updated_at
  };
}
class Gc {
  db;
  constructor(t) {
    this.db = t;
  }
  list() {
    return this.db.prepare("SELECT * FROM saved_scripts ORDER BY folder ASC, name ASC").all().map(me);
  }
  byId(t) {
    const n = this.db.prepare("SELECT * FROM saved_scripts WHERE id = ?").get(t);
    return n ? me(n) : null;
  }
  listByFolder(t) {
    return t === null ? this.db.prepare("SELECT * FROM saved_scripts WHERE folder IS NULL ORDER BY name ASC").all().map(me) : this.db.prepare("SELECT * FROM saved_scripts WHERE folder = ? ORDER BY name ASC").all(t).map(me);
  }
  insert(t) {
    try {
      this.db.prepare(
        `INSERT INTO saved_scripts
           (id, name, folder, tags_json, connection_id, database_name, content, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(t.id, t.name, t.folder, JSON.stringify(t.tags), t.connectionId, t.database, t.content, t.language, t.createdAt, t.updatedAt);
    } catch (n) {
      throw g("LocalPersistence", `Failed to insert script: ${n.message}`);
    }
  }
  update(t) {
    try {
      this.db.prepare(
        `UPDATE saved_scripts SET
           name = ?, folder = ?, tags_json = ?, connection_id = ?, database_name = ?,
           content = ?, language = ?, updated_at = ?
           WHERE id = ?`
      ).run(t.name, t.folder, JSON.stringify(t.tags), t.connectionId, t.database, t.content, t.language, Date.now(), t.id);
    } catch (n) {
      throw g("LocalPersistence", `Failed to update script: ${n.message}`);
    }
  }
  remove(t) {
    try {
      this.db.prepare("DELETE FROM saved_scripts WHERE id = ?").run(t);
    } catch (n) {
      throw g("LocalPersistence", `Failed to delete script: ${n.message}`);
    }
  }
  count() {
    return this.db.prepare("SELECT COUNT(*) c FROM saved_scripts").get().c;
  }
}
class se {
  db;
  profiles;
  groups;
  secrets;
  history;
  workspace;
  settings;
  scripts;
  constructor(t) {
    this.db = t, this.profiles = new Dc(t), this.groups = new xc(t), this.secrets = new jc(t), this.history = new Uc(t), this.workspace = new Mc(t), this.settings = new Fc(t), this.scripts = new Gc(t);
  }
  static open(t) {
    let n;
    try {
      return n = new Xe(t.path, {
        readonly: t.readonly ?? !1,
        fileMustExist: t.readonly ?? !1
      }), n.pragma("journal_mode = WAL"), n.pragma("foreign_keys = ON"), n.pragma("busy_timeout = 5000"), t.readonly || Lc(n), new se(n);
    } catch (r) {
      throw n?.close(), g("LocalPersistence", `Failed to open database: ${r.message}`, {
        causeMessage: r.stack
      });
    }
  }
  static openOrCreate(t) {
    return se.open({ path: t, readonly: !1 });
  }
  static openReadonly(t) {
    return se.open({ path: t, readonly: !0 });
  }
  exec(t, ...n) {
    try {
      return this.db.prepare(t).run(...n);
    } catch (r) {
      throw g("LocalPersistence", `SQL exec failed: ${r.message}`);
    }
  }
  prepare(t) {
    return this.db.prepare(t);
  }
  transaction(t) {
    return this.db.transaction(t);
  }
  close() {
    this.db.close();
  }
  checkIntegrity() {
    try {
      const t = this.db.prepare("PRAGMA integrity_check").get();
      return t && t.integrity_check !== "ok" ? t.integrity_check : null;
    } catch {
      return "integrity_check query failed";
    }
  }
  backup(t) {
    try {
      this.db.exec(`VACUUM INTO '${t.replace(/'/g, "''")}'`);
      const n = this.db.prepare("PRAGMA page_count").get(), { size: r } = bn(t);
      return { path: t, sizeBytes: r, pageCount: n.page_count };
    } catch (n) {
      throw g("LocalPersistence", `Backup failed: ${n.message}`);
    }
  }
  async tryRecover(t) {
    try {
      const n = new Xe(t, { readonly: !0 }), r = n.prepare("PRAGMA integrity_check").get();
      return n.close(), r.integrity_check === "ok";
    } catch {
      return !1;
    }
  }
}
class Wc {
  repo = null;
  fallback = /* @__PURE__ */ new Map();
  bind(t) {
    this.repo = t;
  }
  async getBlob(t) {
    return this.repo ? this.repo.getBlob(t) : this.fallback.get(t) ?? null;
  }
  async setBlob(t, n) {
    this.repo ? this.repo.upsert(t, n) : this.fallback.set(t, n);
  }
  async deleteBlob(t) {
    this.repo ? this.repo.remove(t) : this.fallback.delete(t);
  }
  async hasBlob(t) {
    return this.repo ? this.repo.has(t) : this.fallback.has(t);
  }
  async info() {
    const t = await te.isAsyncEncryptionAvailable();
    let n;
    if (process.platform === "linux")
      try {
        n = te.getSelectedStorageBackend();
      } catch {
        n = "unknown";
      }
    return {
      status: t ? n === "basic_text" ? "plain-text-fallback" : "available" : "unavailable",
      ...n !== void 0 ? { backend: n } : {}
    };
  }
  async set(t, n) {
    try {
      await this.setBlob(t, await te.encryptStringAsync(n));
    } catch (r) {
      throw g("SecureStorageFailure", `Failed to encrypt secret: ${r.message}`);
    }
  }
  async get(t) {
    const n = await this.getBlob(t);
    if (!n) return null;
    try {
      const { result: r, shouldReEncrypt: o } = await te.decryptStringAsync(n);
      return o && await this.setBlob(t, await te.encryptStringAsync(r)), r;
    } catch (r) {
      throw g("SecureStorageFailure", `Failed to decrypt secret (needs re-auth?): ${r.message}`);
    }
  }
  async clear(t) {
    await this.deleteBlob(t);
  }
  async has(t) {
    return this.hasBlob(t);
  }
}
const Nt = new Wc(), hn = "window:state", Jc = 500;
function It(e) {
  const t = e.getRaw(hn);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
function Bc(e, t) {
  e.setRaw(hn, JSON.stringify(t));
}
function $t(e, t) {
  let n = null;
  const r = () => {
    const i = e.getBounds(), s = e.isMaximized();
    Bc(t, { bounds: i, maximized: s });
  }, o = () => {
    n && clearTimeout(n), n = setTimeout(r, Jc);
  };
  return e.on("resize", o), e.on("move", o), e.on("maximize", o), e.on("unmaximize", o), () => {
    n && clearTimeout(n), e.removeListener("resize", o), e.removeListener("move", o), e.removeListener("maximize", o), e.removeListener("unmaximize", o);
  };
}
const D = new Pc({ maxRuntimes: 10, idleTimeoutMS: 900 * 1e3 });
let re = null, M = null;
function Rt() {
  if (!M) throw new Error("Database not initialized");
  return M;
}
function Vc(e) {
  const t = e.senderFrame?.url ?? "";
  return t ? Zt().some((n) => t.startsWith(n)) : !1;
}
async function At() {
  if (re) return re;
  if (process.env.MONGOG_SPIKE_MONGO !== "1") return null;
  const { startSpikeMongo: e } = await import("./spike-mongo-Cs6T-iTr.js");
  return re = await e(
    process.env.MONGOG_SPIKE_REPLSET === "1" ? "replset" : "standalone"
  ), re;
}
j.whenReady().then(async () => {
  if (M = se.openOrCreate(_n(j.getPath("userData"), "mongog.db")), Nt.bind(M.secrets), process.env.MONGOG_SMOKE === "1") {
    const { runSmokeChecks: r } = await import("./smoke-rFiXpwLT.js");
    await r(D, await At(), Rt);
    return;
  }
  D.startSweeper(), Cc(
    {
      supervisor: D,
      getWindow: () => U.getAllWindows()[0] ?? null,
      getSpikeMongoUri: At,
      getDb: Rt,
      secretStore: Nt
    },
    Vc
  ), D.on("engine-event", (r, o, i) => {
    for (const s of U.getAllWindows())
      s.webContents.send(K.engine, { connectionId: r, executionId: o, event: i });
  }), D.on("runtime-connecting", (r) => {
    for (const o of U.getAllWindows())
      o.webContents.send(K.connectionState, {
        connectionId: r,
        status: "connecting"
      });
  }), D.on("runtime-ready", (r, o) => {
    for (const i of U.getAllWindows())
      i.webContents.send(K.connectionState, {
        connectionId: r,
        status: "connected",
        runtimePid: o.pid,
        serverVersion: o.serverVersion,
        connectedAt: o.connectedAt
      });
  }), D.on("runtime-connect-error", (r, o) => {
    for (const i of U.getAllWindows())
      i.webContents.send(K.connectionState, {
        connectionId: r,
        status: "error",
        error: o
      });
  }), D.on("runtime-exit", (r) => {
    for (const o of U.getAllWindows())
      o.webContents.send(K.connectionState, {
        connectionId: r,
        status: "runtime-crashed",
        since: Date.now()
      });
  }), D.on("runtime-idle-evicted", (r) => {
    for (const o of U.getAllWindows())
      o.webContents.send(K.connectionState, {
        connectionId: r,
        status: "disconnected"
      });
  });
  const e = It(M.settings), t = Ke({ windowState: e }), n = $t(t, M.settings);
  t.on("closed", n), j.on("activate", () => {
    if (U.getAllWindows().length === 0) {
      const r = It(M.settings), o = Ke({ windowState: r }), i = $t(o, M.settings);
      o.on("closed", i);
    }
  });
}).catch((e) => {
  console.error("[MongoG main] startup failed", JSON.stringify(Se(e))), j.exit(1);
});
j.on("window-all-closed", () => {
  process.platform !== "darwin" && j.quit();
});
j.on("before-quit", () => {
  re && import("./spike-mongo-Cs6T-iTr.js").then((e) => e.stopSpikeMongo()), D.disposeAll(), M?.close();
});
export {
  Ac as C,
  We as R,
  Nt as a,
  It as l,
  Je as r,
  Bc as s
};
//# sourceMappingURL=main-i0pylBA4.js.map
