import SidePanel from "../SidePanel";

export default function AdminPanel({ open, onClose, users, onSuspend, onUnsuspend, onDelete }) {
  return (
    <SidePanel open={open} title="Admin Dashboard" onClose={onClose}>
      <div className="admin-title">{users.length} Users</div>

      {users.map((u) => (
        <div key={u.id} className="admin-user-card">
          <div className="admin-user-header">
            <img src={u.avatar_url || "https://via.placeholder.com/36"} alt="" className="admin-avatar" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{u.name || "Anonymous"}</div>
              <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{u.email || "No email"}</div>
            </div>
            <span className={`admin-badge ${u.plan === "pro" ? "pro" : "free"}`}>{u.plan || "free"}</span>
            {u.is_admin && <span className="admin-badge admin">Admin</span>}
          </div>

          {/* Reuses .msg-actions for layout, forced visible — that class hides
              itself until its row is hovered, which is wrong here. */}
          <div className="msg-actions" style={{ justifyContent: "flex-start", marginTop: 8, opacity: 1 }}>
            {u.suspended ? (
              <button onClick={() => onUnsuspend(u.id)} className="msg-action-btn">
                Unsuspend
              </button>
            ) : (
              <button onClick={() => onSuspend(u.id)} className="msg-action-btn">
                Suspend
              </button>
            )}
            <button onClick={() => onDelete(u.id)} className="msg-action-btn" style={{ color: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </SidePanel>
  );
}
