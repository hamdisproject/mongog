import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionProfile,
  TestConnectionResult,
  WorkspaceTab,
} from '../../../shared/domain/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { theme } from '../../theme.js';
import {
  connectionRequest,
  draftFromProfile,
  emptyConnectionDraft,
  splitCredentialsFromUri,
  type ConnectionFormDraft,
} from './connection-draft.js';

const c = theme.colors;
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: c.input, color: c.text,
  border: `1px solid ${c.borderStrong}`, borderRadius: theme.radius, padding: '8px 9px',
  fontSize: 12, outline: 0,
};
const button: React.CSSProperties = {
  border: 0, borderRadius: theme.radius, background: c.accent, color: '#fff',
  padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
};

export function ConnectionsView({ tab }: { tab: WorkspaceTab }) {
  const profiles = useConnectionStore((state) => state.profiles);
  const groups = useConnectionStore((state) => state.groups);
  const connected = useConnectionStore((state) => state.connected);
  const connectionErrors = useConnectionStore((state) => state.errors);
  const testDraft = useConnectionStore((state) => state.testDraft);
  const saveAndConnect = useConnectionStore((state) => state.saveAndConnect);
  const deleteProfile = useConnectionStore((state) => state.deleteProfile);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [formMode, setFormMode] = useState<'basic' | 'advanced'>('basic');
  const [form, setForm] = useState<ConnectionFormDraft>(() => emptyConnectionDraft());
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);
  const skipNextProfileSync = useRef(false);
  const selected = profiles.find((profile) => profile.id === tab.profileId);
  const mode = tab.connectionMode ?? (selected ? 'edit' : 'list');

  useEffect(() => {
    if (skipNextProfileSync.current) {
      skipNextProfileSync.current = false;
      return;
    }
    setResult(null);
    setMessage(null);
    setFormMode('basic');
    if (mode === 'create') setForm(emptyConnectionDraft());
    else if (selected) setForm(draftFromProfile(selected));
  }, [mode, selected?.id, selected?.updatedAt]);

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return profiles
      .filter((profile) => groupFilter === 'all' || (groupFilter === 'ungrouped' ? !profile.groupId : profile.groupId === groupFilter))
      .filter((profile) => !needle || `${profile.name} ${profile.uriRedacted} ${profile.defaultDatabase ?? ''}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, query, groupFilter]);

  const update = <K extends keyof ConnectionFormDraft>(key: K, value: ConnectionFormDraft[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setResult(null);
    setMessage(null);
  };

  const selectProfile = (profile: ConnectionProfile) => {
    updateTab(tab.id, { profileId: profile.id, connectionMode: 'edit' });
  };

  const newProfile = () => {
    updateTab(tab.id, { profileId: undefined, connectionMode: 'create' });
  };

  const request = () => connectionRequest(form, mode === 'edit' ? selected?.id : undefined);

  const runTest = async () => {
    setBusy('test'); setMessage(null); setResult(null);
    try {
      const test = await testDraft(request());
      setResult(test);
      setMessage(test.ok
        ? { kind: 'success', text: `Connection succeeded in ${test.roundTripMs ?? 0} ms${test.serverVersion ? ` · MongoDB ${test.serverVersion}` : ''}.` }
        : { kind: 'error', text: test.error?.message ?? 'Connection test failed.' });
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause) });
    } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setMessage(null); setResult(null);
    try {
      const saved = await saveAndConnect(request());
      setResult(saved.test);
      if (!saved.saved || !saved.profile) {
        setMessage({ kind: 'error', text: saved.test.error?.message ?? 'The connection could not be validated.' });
        return;
      }
      // The response already contains the canonical saved profile. Avoid the
      // profile-selection effect immediately clearing this operation's result
      // and success/warning feedback.
      skipNextProfileSync.current = mode !== 'edit' || selected?.id !== saved.profile.id;
      updateTab(tab.id, { profileId: saved.profile.id, connectionMode: 'edit' });
      setForm(draftFromProfile(saved.profile));
      setMessage(saved.connected
        ? { kind: 'success', text: 'Connection tested, saved, and connected.' }
        : { kind: 'warning', text: `Profile saved, but the final connection failed: ${saved.connectionError?.message ?? 'Unknown error'}` });
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause) });
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Delete "${selected.name}"?\n\nThis removes its encrypted credentials and query history. Saved scripts are kept but detached from the connection.`,
    );
    if (!confirmed) return;
    setBusy('delete'); setMessage(null);
    try {
      await deleteProfile(selected.id);
      updateTab(tab.id, { profileId: undefined, connectionMode: 'list' });
      setForm(emptyConnectionDraft());
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause) });
    } finally { setBusy(null); }
  };

  const toggleConnection = async (profile: ConnectionProfile) => {
    setMessage(null);
    try {
      if (connected[profile.id]) await disconnect(profile.id);
      else await connect(profile.id);
    } catch (cause) {
      setMessage({ kind: 'error', text: errorMessage(cause) });
    }
  };

  const handleUri = (value: string) => {
    const parsed = splitCredentialsFromUri(value);
    setForm((current) => ({
      ...current,
      uri: parsed.uri,
      ...(parsed.username !== undefined ? { username: parsed.username } : {}),
      ...(parsed.password !== undefined ? { password: parsed.password, secretMode: 'replace' as const } : {}),
    }));
    setResult(null); setMessage(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, background: c.app }}>
      <aside style={{ width: 310, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${c.border}`, background: c.panel }}>
        <div style={{ padding: 14, borderBottom: `1px solid ${c.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
            <div><strong style={{ fontSize: 14 }}>Connections</strong><div style={{ color: c.textFaint, fontSize: 10, marginTop: 2 }}>{profiles.length} saved profiles</div></div>
            <button style={button} onClick={newProfile}>+ New</button>
          </div>
          <input aria-label="Search connections" style={input} placeholder="Search connections" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by group" style={{ ...input, marginTop: 7 }} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All groups</option><option value="ungrouped">Ungrouped</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 7 }}>
          {filteredProfiles.map((profile) => {
            const active = selected?.id === profile.id && mode === 'edit';
            const online = Boolean(connected[profile.id]);
            const connectionError = connectionErrors[profile.id];
            return <div key={profile.id} onClick={() => selectProfile(profile)} style={{ padding: '10px 9px', borderRadius: 5, background: active ? c.selected : 'transparent', cursor: 'pointer', marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: connectionError ? c.danger : online ? c.success : (profile.color ?? c.textFaint) }} />
                <strong style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</strong>
                <button onClick={(event) => { event.stopPropagation(); void toggleConnection(profile); }} style={{ border: 0, background: 'transparent', color: online ? c.warning : c.success, cursor: 'pointer', fontSize: 10 }}>{online ? 'DISCONNECT' : 'CONNECT'}</button>
              </div>
              <div style={{ color: c.textMuted, fontSize: 10, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connectionError ?? profile.uriRedacted}</div>
            </div>;
          })}
          {filteredProfiles.length === 0 && <div style={{ color: c.textFaint, textAlign: 'center', fontSize: 12, padding: 28 }}>No matching connections.</div>}
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {mode === 'list' && !selected ? (
          <EmptyState onCreate={newProfile} />
        ) : (
          <div style={{ width: 'min(820px, calc(100% - 48px))', margin: '0 auto', padding: '30px 0 48px' }}>
            <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', marginBottom: 20 }}>
              <div><h1 style={{ fontSize: 22, margin: 0 }}>{mode === 'create' ? 'New connection' : `Edit ${selected?.name ?? 'connection'}`}</h1><p style={{ color: c.textMuted, fontSize: 12, margin: '6px 0 0' }}>Credentials stay in secure storage and are never returned to the renderer.</p></div>
              {selected && mode === 'edit' && <button style={{ ...button, background: c.dangerSurface, color: c.danger }} disabled={busy !== null} onClick={() => void remove()}>Delete</button>}
            </div>

            <div style={{ display: 'flex', gap: 3, borderBottom: `1px solid ${c.border}`, marginBottom: 18 }}>
              {(['basic', 'advanced'] as const).map((item) => <button key={item} onClick={() => setFormMode(item)} style={{ border: 0, borderBottom: `2px solid ${formMode === item ? c.accentHover : 'transparent'}`, background: 'transparent', color: formMode === item ? c.text : c.textMuted, padding: '9px 13px', textTransform: 'capitalize', cursor: 'pointer' }}>{item}</button>)}
            </div>

            {formMode === 'basic' ? <BasicForm form={form} groups={groups} update={update} onUri={handleUri} /> : <AdvancedForm form={form} update={update} />}

            {message && <div style={{ marginTop: 14, border: `1px solid ${message.kind === 'error' ? '#7a3535' : message.kind === 'warning' ? '#71642c' : '#27543b'}`, background: message.kind === 'error' ? c.dangerSurface : message.kind === 'warning' ? '#343019' : '#193927', color: message.kind === 'error' ? c.danger : message.kind === 'warning' ? c.warning : '#b9e4c9', padding: 10, borderRadius: theme.radius, fontSize: 12 }}>{message.text}</div>}
            {result?.ok && <div style={{ color: c.textFaint, fontSize: 10, marginTop: 6 }}>Topology: {result.topology ?? 'unknown'} · Round trip: {result.roundTripMs ?? 0} ms</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${c.border}` }}>
              <button style={{ ...button, background: c.panelRaised, border: `1px solid ${c.borderStrong}`, color: c.text }} disabled={busy !== null} onClick={() => void runTest()}>{busy === 'test' ? 'Testing…' : 'Test Connection'}</button>
              <button style={button} disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? 'Testing & Saving…' : 'Test, Save & Connect'}</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function BasicForm({ form, groups, update, onUri }: {
  form: ConnectionFormDraft;
  groups: Array<{ id: string; name: string }>;
  update: <K extends keyof ConnectionFormDraft>(key: K, value: ConnectionFormDraft[K]) => void;
  onUri: (uri: string) => void;
}) {
  return <section style={section}>
    <div style={grid2}>
      <Field label="Connection name"><input style={input} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="My MongoDB" /></Field>
      <Field label="Group"><select style={input} value={form.groupId} onChange={(event) => update('groupId', event.target.value)}><option value="">Ungrouped</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
    </div>
    <Field label="Connection URI" hint="Credentials pasted in a URI are moved to the secure fields below."><input style={input} value={form.uri} onChange={(event) => onUri(event.target.value)} spellCheck={false} /></Field>
    <div style={grid2}>
      <Field label="Username"><input autoComplete="off" style={input} value={form.username} onChange={(event) => update('username', event.target.value)} /></Field>
      <Field label={form.secretMode === 'preserve' ? 'Password (stored credential preserved)' : 'Password'}><input autoComplete="new-password" type="password" style={input} value={form.password} placeholder={form.secretMode === 'preserve' ? 'Leave blank to preserve' : ''} onChange={(event) => { update('password', event.target.value); update('secretMode', 'replace'); }} /></Field>
    </div>
    {form.secretMode === 'preserve' && <button style={linkButton} onClick={() => { update('username', ''); update('password', ''); update('secretMode', 'clear'); }}>Remove stored credentials</button>}
    {form.secretMode === 'clear' && <button style={linkButton} onClick={() => update('secretMode', 'preserve')}>Keep stored credentials instead</button>}
    <div style={grid2}>
      <Field label="Default database"><input style={input} value={form.defaultDatabase} onChange={(event) => update('defaultDatabase', event.target.value)} placeholder="Optional" /></Field>
      <Field label="Profile color"><input aria-label="Profile color" type="color" style={{ ...input, height: 34, padding: 3 }} value={form.color} onChange={(event) => update('color', event.target.value)} /></Field>
    </div>
    <label style={checkbox}><input type="checkbox" checked={form.readOnly} onChange={(event) => update('readOnly', event.target.checked)} /> Protect this connection as read-only</label>
  </section>;
}

function AdvancedForm({ form, update }: {
  form: ConnectionFormDraft;
  update: <K extends keyof ConnectionFormDraft>(key: K, value: ConnectionFormDraft[K]) => void;
}) {
  return <section style={section}>
    <h3 style={heading}>Authentication & topology</h3>
    <div style={grid2}>
      <Field label="Authentication mechanism"><select style={input} value={form.authMechanism} onChange={(event) => update('authMechanism', event.target.value as ConnectionFormDraft['authMechanism'])}><option value="">SCRAM / driver default</option><option value="MONGODB-X509">MONGODB-X509</option><option value="MONGODB-AWS">MONGODB-AWS</option><option value="MONGODB-OIDC">MONGODB-OIDC</option></select></Field>
      <Field label="Authentication source"><input style={input} value={form.authSource} onChange={(event) => update('authSource', event.target.value)} placeholder="admin" /></Field>
      <Field label="Read preference"><select style={input} value={form.readPreference} onChange={(event) => update('readPreference', event.target.value as ConnectionFormDraft['readPreference'])}><option value="primary">primary</option><option value="primaryPreferred">primaryPreferred</option><option value="secondary">secondary</option><option value="secondaryPreferred">secondaryPreferred</option><option value="nearest">nearest</option></select></Field>
      <Field label="Application name"><input style={input} value={form.appName} onChange={(event) => update('appName', event.target.value)} /></Field>
    </div>
    <h3 style={heading}>Timeouts (milliseconds)</h3>
    <div style={grid2}>
      <NumberField label="Connect timeout" value={form.connectTimeoutMS} set={(value) => update('connectTimeoutMS', value)} />
      <NumberField label="Server selection timeout" value={form.serverSelectionTimeoutMS} set={(value) => update('serverSelectionTimeoutMS', value)} />
      <NumberField label="Socket timeout" value={form.socketTimeoutMS} set={(value) => update('socketTimeoutMS', value)} />
      <NumberField label="Operation timeout" value={form.timeoutMS} set={(value) => update('timeoutMS', value)} />
    </div>
    <h3 style={heading}>Connection pool</h3>
    <div style={grid2}><NumberField label="Minimum pool size" value={form.minPoolSize} set={(value) => update('minPoolSize', value)} /><NumberField label="Maximum pool size" value={form.maxPoolSize} set={(value) => update('maxPoolSize', value)} /></div>
    <h3 style={heading}>Driver behavior</h3>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px' }}>
      <Check label="Retry reads" checked={form.retryReads} set={(value) => update('retryReads', value)} />
      <Check label="Retry writes" checked={form.retryWrites} set={(value) => update('retryWrites', value)} />
      <Check label="Direct connection" checked={form.directConnection} set={(value) => update('directConnection', value)} />
      <Check label="Enable TLS" checked={form.tlsEnabled} set={(value) => update('tlsEnabled', value)} />
      <Check label="Allow invalid certificates" checked={form.allowInvalidCertificates} disabled={!form.tlsEnabled} set={(value) => update('allowInvalidCertificates', value)} />
    </div>
  </section>;
}

const section: React.CSSProperties = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 7, padding: 17 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 14px' };
const heading: React.CSSProperties = { color: c.text, fontSize: 12, margin: '4px 0 11px', paddingBottom: 6, borderBottom: `1px solid ${c.border}` };
const checkbox: React.CSSProperties = { color: c.textMuted, fontSize: 12, display: 'flex', alignItems: 'center', gap: 7, marginTop: 13 };
const linkButton: React.CSSProperties = { border: 0, background: 'transparent', color: '#75b9e7', padding: '0 0 12px', cursor: 'pointer', fontSize: 11 };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 12 }}><span style={{ display: 'block', color: c.textMuted, fontSize: 11, marginBottom: 5 }}>{label}</span>{children}{hint && <span style={{ display: 'block', color: c.textFaint, fontSize: 10, marginTop: 4 }}>{hint}</span>}</label>;
}
function NumberField({ label, value, set }: { label: string; value: string; set: (value: string) => void }) {
  return <Field label={label}><input type="number" min={0} style={input} value={value} onChange={(event) => set(event.target.value)} /></Field>;
}
function Check({ label, checked, set, disabled = false }: { label: string; checked: boolean; set: (value: boolean) => void; disabled?: boolean }) {
  return <label style={{ ...checkbox, marginTop: 0, opacity: disabled ? 0.45 : 1 }}><input disabled={disabled} type="checkbox" checked={checked} onChange={(event) => set(event.target.checked)} />{label}</label>;
}
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><div style={{ textAlign: 'center', maxWidth: 390 }}><div style={{ fontSize: 36, color: c.success, marginBottom: 12 }}>●</div><h2 style={{ margin: 0, fontSize: 20 }}>Manage MongoDB connections</h2><p style={{ color: c.textMuted, fontSize: 12, lineHeight: 1.6 }}>Select a saved profile or create a new connection. Basic mode covers common setups; Advanced exposes driver and TLS controls.</p><button style={button} onClick={onCreate}>Create Connection</button></div></div>;
}
function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
