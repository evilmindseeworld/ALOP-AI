import { memo, useState } from "react";
import Icon from "./Icon";

const ChatItem = memo(({ chat, activeChatId, onSelect, onRename, onDelete, onPin, onFavorite }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title || "New Chat");

  const commit = () => {
    onRename(chat.id, editTitle);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setEditTitle(chat.title || "New Chat");
      setEditing(false);
    }
  };

  return (
    <div
      className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${
        chat.favorite ? "favorite" : ""
      }`}
      onClick={() => onSelect(chat.id)}
    >
      <div className="chat-title">
        {editing ? (
          <input
            className="custom-input"
            style={{ padding: "4px 8px", fontSize: 12 }}
            value={editTitle}
            autoFocus
            aria-label="Chat title"
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            // Without this, clicking into the field selects the chat and the
            // row re-renders out from under the caret.
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          chat.title || "New Chat"
        )}
      </div>

      {/* The row itself is the select target, so the buttons have to stop
          propagation or every action would also switch chats. */}
      <div className="chat-actions" onClick={(e) => e.stopPropagation()}>
        <button className="chat-action" onClick={() => onPin(chat.id)} title="Pin" aria-label="Pin chat">
          <Icon name="pin" size={13} />
        </button>
        <button className="chat-action" onClick={() => onFavorite(chat.id)} title="Favorite" aria-label="Favorite chat">
          <Icon name="heart" size={13} />
        </button>
        <button
          className="chat-action"
          onClick={() => {
            setEditing(true);
            setEditTitle(chat.title || "New Chat");
          }}
          title="Rename"
          aria-label="Rename chat"
        >
          ✎
        </button>
        <button className="chat-action" onClick={() => onDelete(chat.id)} title="Delete" aria-label="Delete chat">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
});

ChatItem.displayName = "ChatItem";

const ChatSidebar = memo(
  ({
    chats,
    activeChatId,
    onSelect,
    onCreate,
    onDelete,
    onRename,
    onPin,
    onFavorite,
    collapsed,
    mobileOpen,
    setMobileOpen,
  }) => (
    <div
      className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${
        typeof window !== "undefined" && window.innerWidth <= 768 ? "mobile" : ""
      }`}
    >
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onCreate}>
          <Icon name="plus" size={16} /> New Chat
        </button>
        {mobileOpen && (
          <button className="icon-btn" onClick={() => setMobileOpen(false)} aria-label="Close chat list">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>

      <div className="chat-list">
        {chats.length === 0 && (
          <div style={{ textAlign: "center", opacity: 0.5, padding: 20, fontSize: 13 }}>No chats yet</div>
        )}
        {chats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            activeChatId={activeChatId}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onPin={onPin}
            onFavorite={onFavorite}
          />
        ))}
      </div>

      <div className="sidebar-footer">ALOP-AI • Council of Minds • Learning</div>
    </div>
  )
);

ChatSidebar.displayName = "ChatSidebar";

export { ChatItem };
export default ChatSidebar;
