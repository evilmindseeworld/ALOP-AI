import { memo, useState, useMemo } from "react";
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
        <button
          className={`chat-action ${chat.pinned ? "is-on" : ""}`}
          onClick={() => onPin(chat.id)}
          title={chat.pinned ? "Unpin" : "Pin"}
          aria-label={chat.pinned ? "Unpin chat" : "Pin chat"}
          aria-pressed={Boolean(chat.pinned)}
        >
          <Icon name="pin" size={13} />
        </button>
        <button
          className={`chat-action ${chat.favorite ? "is-on" : ""}`}
          onClick={() => onFavorite(chat.id)}
          title={chat.favorite ? "Remove from favourites" : "Favourite"}
          aria-label={chat.favorite ? "Remove chat from favourites" : "Favourite chat"}
          aria-pressed={Boolean(chat.favorite)}
        >
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
        <button
          className="chat-action is-danger"
          onClick={() => onDelete(chat.id)}
          title="Delete"
          aria-label="Delete chat"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
  );
});

ChatItem.displayName = "ChatItem";

/**
 * Pinned, then favourites, then the rest.
 *
 * The list arrives already sorted in that order from useChats; this only marks
 * where one run ends and the next begins. It replaces the coloured left border
 * the old list used, which said "this row is special" without ever saying which
 * kind of special — and put two different meanings on the same 2px of pixels.
 */
const groupChats = (chats) => {
  const pinned = chats.filter((c) => c.pinned);
  const favorite = chats.filter((c) => !c.pinned && c.favorite);
  const rest = chats.filter((c) => !c.pinned && !c.favorite);

  return [
    { key: "pinned", label: "Pinned", chats: pinned },
    { key: "favorite", label: "Favourites", chats: favorite },
    // Unlabelled when it is the only group: a single "Recent" heading over the
    // whole list is a label with nothing to distinguish it from.
    { key: "recent", label: pinned.length || favorite.length ? "Recent" : null, chats: rest },
  ].filter((g) => g.chats.length > 0);
};

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
  }) => {
    const groups = useMemo(() => groupChats(chats), [chats]);

    return (
      <nav
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""} ${
          typeof window !== "undefined" && window.innerWidth <= 768 ? "mobile" : ""
        }`}
        aria-label="Chats"
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
          {chats.length === 0 && <div className="chat-empty">No chats yet</div>}

          {groups.map((group) => (
            <div className="chat-group" key={group.key}>
              {group.label && <div className="chat-group-label">{group.label}</div>}
              {group.chats.map((chat) => (
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
          ))}
        </div>

        <div className="sidebar-footer">ALOP-AI • Council of Minds</div>
      </nav>
    );
  }
);

ChatSidebar.displayName = "ChatSidebar";

export { ChatItem, groupChats };
export default ChatSidebar;
