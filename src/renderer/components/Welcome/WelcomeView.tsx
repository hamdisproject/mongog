import { useState } from 'react';
import type { ConnectionProfile } from '../../../shared/domain/index.js';
import { useConnectionStore } from '../../stores/connections.js';
import { useWorkspaceStore } from '../../stores/workspace.js';
import { theme } from '../../theme.js';
import { MongoGBrand } from '../Brand/MongoGBrand.js';

const c = theme.colors;
const card: React.CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.border}`,
  borderRadius: 8,
  padding: 16,
};
const button: React.CSSProperties = {
  border: 0,
  borderRadius: theme.radius,
  background: c.accent,
  color: '#fff',
  padding: '9px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const examples = [
  { title: 'Find documents', code: 'db.collection("orders").find({ status: "open" }).limit(20);' },
  { title: 'Aggregate data', code: 'db.collection("orders").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);' },
  { title: 'Inspect the server', code: 'await db.command({ ping: 1 });' },
];

export function WelcomeView() {
  const profiles = useConnectionStore((state) => state.profiles);
  const connected = useConnectionStore((state) => state.connected);
  const connect = useConnectionStore((state) => state.connect);
  const openConnections = useWorkspaceStore((state) => state.openConnections);
  const createTab = useWorkspaceStore((state) => state.createTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = [...profiles].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);

  const openProfile = async (profile: ConnectionProfile) => {
    setOpeningId(profile.id);
    setError(null);
    try {
      if (!connected[profile.id]) await connect(profile.id);
      const databases = await window.mongog.query.listDatabases(profile.id);
      const database = profile.defaultDatabase
        ?? databases.find((item) => !['admin', 'config', 'local'].includes(item.name))?.name
        ?? 'test';
      const tabId = createTab('query', profile.id);
      updateTab(tabId, {
        title: `${profile.name} · ${database}`,
        database,
        editorContent: 'await db.command({ ping: 1 });\n',
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', background: c.app }}>
      <main style={{ width: 'min(1040px, calc(100% - 48px))', margin: '0 auto', padding: '54px 0 48px' }}>
        <section style={{ marginBottom: 34 }}>
          <MongoGBrand size="hero" testId="welcome-mongog-brand" />
          <div style={{ marginTop: 23 }}>
            <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: '0 0 10px', color: c.text }}>Welcome back</h1>
            <p style={{ maxWidth: 580, color: c.textMuted, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
              Connect to MongoDB, explore collections, run typed scripts, and manage your data from one secure desktop workspace.
            </p>
          </div>
        </section>

        <section style={{ display: 'flex', gap: 10, marginBottom: 34 }}>
          <button style={button} onClick={() => openConnections({ mode: 'create' })}>New Connection</button>
          <button style={{ ...button, background: c.panelRaised, border: `1px solid ${c.borderStrong}`, color: c.text }} onClick={() => openConnections({ mode: 'list' })}>Open Connections</button>
        </section>

        {error && <div style={{ ...card, borderColor: '#7a3535', color: c.danger, marginBottom: 18 }}>{error}</div>}

        <section style={{ marginBottom: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 15, margin: 0, color: c.text }}>Recent connections</h2>
            <span style={{ fontSize: 11, color: c.textFaint }}>{profiles.length} saved</span>
          </div>
          {recent.length === 0 ? (
            <div style={{ ...card, color: c.textMuted, textAlign: 'center', padding: 28 }}>
              No connections yet. Create one to start exploring MongoDB.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(245px, 1fr))', gap: 10 }}>
              {recent.map((profile) => {
                const isConnected = Boolean(connected[profile.id]);
                return <button key={profile.id} onClick={() => void openProfile(profile)} disabled={openingId !== null} style={{ ...card, textAlign: 'left', color: c.text, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: isConnected ? c.success : (profile.color ?? c.textFaint), boxShadow: isConnected ? `0 0 10px ${c.success}` : undefined }} />
                    <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</strong>
                    <span style={{ color: isConnected ? c.success : c.textFaint, fontSize: 10 }}>{isConnected ? 'CONNECTED' : 'OPEN'}</span>
                  </div>
                  <div style={{ color: c.textMuted, fontSize: 11, marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.uriRedacted}</div>
                  <div style={{ color: c.textFaint, fontSize: 11, marginTop: 5 }}>{profile.defaultDatabase ?? 'Choose database automatically'}</div>
                </button>;
              })}
            </div>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 15, margin: '0 0 10px', color: c.text }}>Quick examples</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {examples.map((example) => <div key={example.title} style={card}>
              <div style={{ color: c.text, fontSize: 12, fontWeight: 650, marginBottom: 9 }}>{example.title}</div>
              <code style={{ color: '#b5cea8', fontSize: 11, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{example.code}</code>
            </div>)}
          </div>
        </section>
      </main>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}
