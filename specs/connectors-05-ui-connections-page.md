## Connectors 05: UI Connections Page

### Goal

Create a dedicated UI for managing service connections with multi-account support.

### Navigation

Add "Connections" to settings or as top-level nav item:
- Settings page gets "Connections" section/tab
- Or: Separate `/connections` route

### Connections list view

```
┌─────────────────────────────────────────────────────────┐
│ Connections                                    [+ Add]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Gmail                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 📧 user@gmail.com              Connected    [⋮] │   │
│  │    Personal                                      │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 📧 work@company.com            ⚠ Error     [⋮] │   │
│  │    Work · Token expired - Reconnect              │   │
│  └─────────────────────────────────────────────────┘   │
│  [+ Add Gmail account]                                  │
│                                                         │
│  Google Drive                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 📁 user@gmail.com              Connected    [⋮] │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Notion                                                 │
│  No accounts connected                                  │
│  [+ Connect Notion]                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Add connection flow

1. User clicks "+ Add" or "+ Connect [Service]"
2. Modal shows available services (if clicked general "+ Add")
3. User selects service
4. OAuth popup opens
5. User completes OAuth in popup
6. Popup closes, sends postMessage
7. UI refreshes connection list
8. Toast: "Connected user@gmail.com"

### Connection card component

```tsx
interface ConnectionCardProps {
  connection: Connection;
  service: ServiceDefinition;
  onDisconnect: () => void;
  onReconnect: () => void;
  onRename: (label: string) => void;
}

function ConnectionCard({ connection, service, ... }: ConnectionCardProps) {
  return (
    <div className="connection-card">
      <div className="connection-icon">{service.icon}</div>
      <div className="connection-info">
        <div className="connection-account">{connection.id.accountId}</div>
        {connection.label && (
          <div className="connection-label">{connection.label}</div>
        )}
        {connection.status === 'error' && (
          <div className="connection-error">
            {connection.error} · <button onClick={onReconnect}>Reconnect</button>
          </div>
        )}
      </div>
      <StatusBadge status={connection.status} />
      <DropdownMenu>
        <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
        <MenuItem onClick={onReconnect}>Reconnect</MenuItem>
        <MenuItem onClick={onDisconnect} destructive>Disconnect</MenuItem>
      </DropdownMenu>
    </div>
  );
}
```

### Status badges

| Status | Badge | Color |
|--------|-------|-------|
| connected | Connected | Green |
| expired | Expired | Yellow |
| error | Error | Red |

### Add service modal

```tsx
function AddServiceModal({ services, onSelect, onClose }) {
  return (
    <Modal title="Connect a service" onClose={onClose}>
      <div className="service-grid">
        {services.map(service => (
          <button
            key={service.id}
            className="service-option"
            onClick={() => onSelect(service)}
          >
            <ServiceIcon service={service} />
            <span>{service.name}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
```

### OAuth popup handling

```tsx
function useOAuthPopup() {
  const [pending, setPending] = useState<string | null>(null);

  const startOAuth = async (service: string) => {
    setPending(service);

    // Get auth URL from server (server constructs redirect URI internally)
    const { authUrl } = await api.post(`/api/connectors/${service}/connect`, {});

    // Open in new window/tab (external browser in Electron)
    window.open(authUrl, 'oauth', 'width=600,height=700');

    // No postMessage listener needed - connection appears via db sync
    // UI will update automatically when connection is added to db
    // Just clear pending state after a timeout or when user returns
  };

  return { startOAuth, pending };
}

// To clear pending state, watch for new connections:
useEffect(() => {
  if (pending && connections.some(c => c.service === pending)) {
    setPending(null);
    toast.success('Account connected');
  }
}, [connections, pending]);
```

### Rename modal

Simple modal with text input for connection label:
```
┌───────────────────────────────┐
│ Rename connection             │
├───────────────────────────────┤
│ Label                         │
│ ┌───────────────────────────┐ │
│ │ Work Account              │ │
│ └───────────────────────────┘ │
│                               │
│         [Cancel]  [Save]      │
└───────────────────────────────┘
```

### Disconnect confirmation

```
┌───────────────────────────────┐
│ Disconnect user@gmail.com?    │
├───────────────────────────────┤
│ Automations using this        │
│ account will stop working.    │
│                               │
│       [Cancel]  [Disconnect]  │
└───────────────────────────────┘
```

### Integration with SettingsPage

Option A: Add Connections as tab in SettingsPage
Option B: Keep SettingsPage simple, link to separate Connections page

Recommend Option A for now - less navigation, everything in one place.

### State management

Connections live in CRSQLite db, so use existing live query pattern:

```tsx
// hooks/useConnections.ts
function useConnections() {
  // Live query - automatically updates when db changes (including from sync)
  const connections = useLiveQuery(
    () => db.selectFrom('connections').selectAll().execute(),
    []
  );

  // Services are static, can fetch once or define in code
  const services = useMemo(() => [
    gmailService, gdriveService, gsheetsService, gdocsService, notionService
  ], []);

  return {
    connections: connections ?? [],
    services,
    loading: connections === undefined
  };
}
```

No need for manual refetch - db sync handles it:
- OAuth completes → server writes to db → sync → UI updates
- Mobile client reconnects → sync → sees new connections
- Error occurs → server updates db → sync → UI shows error badge
```

### Mobile responsiveness

- Cards stack vertically on mobile
- Service sections collapsible
- OAuth popup works on mobile (may open in same tab with redirect back)
