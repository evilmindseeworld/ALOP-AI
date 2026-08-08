import { memo, useState, useMemo, useCallback, useRef } from "react";
import Icon from "./Icon";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "./ui/tooltip";

/** One name for the untitled case, used by the row, the rail and the filter.
 *
 * The filter searches THIS, not `chat.title`. Searching the raw field means
 * typing what is on screen — "New Chat" — matches nothing, and a filter that
 * cannot find a row the user is looking at is worse than no filter. */
const displayTitle = (chat) => chat.title || "New Chat";

const ChatItem = memo(({ chat, activeChatId, onSelect, onRename, onDelete, onPin, onFavorite }) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(displayTitle(chat));

  const commit = () => {
    onRename(chat.id, editTitle);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setEditTitle(displayTitle(chat));
      setEditing(false);
    }
  };

  return (
    <div
      className={`chat-item ${chat.id === activeChatId ? "active" : ""} ${chat.pinned ? "pinned" : ""} ${
        chat.favorite ? "favorite" : ""
      }`}
    >
      {/* The select target is a BUTTON, and the actions are its siblings.
       *
       * The row used to be a div carrying the onClick, which had two costs: it
       * was unreachable from the keyboard, and every action button inside it
       * had to stopPropagation or deleting a chat would also switch to it on
       * the way out. Siblings have no propagation to stop. */}
      {editing ? (
        <input
          className="custom-input chat-title-input"
          value={editTitle}
          autoFocus
          aria-label="Chat title"
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button className="chat-title" onClick={() => onSelect(chat.id)} title={displayTitle(chat)}>
          {displayTitle(chat)}
        </button>
      )}

      <div className="chat-actions">
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
            setEditTitle(displayTitle(chat));
          }}
          title="Rename"
          aria-label="Rename chat"
        >
          <Icon name="pencil" size={13} />
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
 *
 * Empty groups are dropped, which is also what makes the filter behave: a
 * search matching one favourite must not leave "Pinned" and "Recent" headings
 * standing over nothing.
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

/** How many chats the rail shows before it runs out of column. */
const RAIL_LIMIT = 12;

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
    error = null,
    onRetry,
    collapsed,
    mobileOpen,
    setMobileOpen,
    onExpand,
    userName,
    userPlan,
    userImageUrl,
    onUpgrade,
  }) => {
    const [query, setQuery] = useState("");
    const searchRef = useRef(null);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      if (!q) return chats;
      return chats.filter((c) => displayTitle(c).toLowerCase().includes(q));
    }, [chats, query]);

    const groups = useMemo(() => groupChats(filtered), [filtered]);

    /**
     * Arrow keys walk the rows, Home and End jump to the ends, and both ends
     * wrap. Focus is read from the DOM rather than tracked in state, so it
     * stays correct while the filter is adding and removing rows underneath —
     * an index into a list that just changed length is a stale index.
     */
    const onListKeyDown = useCallback((e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;

      const items = [...e.currentTarget.querySelectorAll(".chat-title")];
      if (items.length === 0) return;
      e.preventDefault();

      const at = items.indexOf(document.activeElement);
      const last = items.length - 1;
      let next;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = last;
      else if (at === -1) next = e.key === "ArrowDown" ? 0 : last;
      else next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;

      items[next]?.focus();
    }, []);

    const expandAndSearch = useCallback(() => {
      onExpand?.();
      // The sidebar has to be open before the field exists to focus.
      requestAnimationFrame(() => searchRef.current?.focus());
    }, [onExpand]);

    const isPro = userPlan === "pro";

    return (
      <nav
        className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobileOpen" : ""}`}
        aria-label="Chats"
      >
        {/* BOTH the rail and the full list are always rendered, and the cascade
            decides which one is visible.
​
            This has to be a CSS decision. `collapsed` defaults to true, so on a
            phone the FIRST render is collapsed — and a component that swapped
            in rail markup there would put a 56px icon column inside a 300px
            drawer. `display: none` also removes the hidden copy from the
            accessibility tree, so nothing is announced twice. */}
        <TooltipProvider delayDuration={200}>
          <div className="sidebar-rail" aria-hidden={!collapsed}>
            <button className="rail-btn rail-new" onClick={onCreate} aria-label="New chat" title="New chat">
              <Icon name="plus" size={17} />
            </button>
            <button
              className="rail-btn rail-search"
              onClick={expandAndSearch}
              aria-label="Search chats"
              title="Search chats"
            >
              <Icon name="search" size={16} />
            </button>

            <div className="rail-divider" />

            <div className="rail-chats">
              {chats.slice(0, RAIL_LIMIT).map((chat) => (
                <Tooltip key={chat.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`rail-chat ${chat.id === activeChatId ? "active" : ""}`}
                      onClick={() => onSelect(chat.id)}
                      aria-label={displayTitle(chat)}
                    >
                      {displayTitle(chat).trim().charAt(0).toUpperCase()}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{displayTitle(chat)}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </TooltipProvider>

        <div className="sidebar-full">
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

          {/* Nothing to search when there is nothing in the list, and a search
              field over an empty list is a control that cannot succeed. */}
          {chats.length > 0 && (
            <div className="sidebar-search">
              <Icon name="search" size={14} />
              <input
                ref={searchRef}
                className="sidebar-search-input"
                type="text"
                value={query}
                placeholder="Search chats"
                aria-label="Search chats"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              {query && (
                <button className="sidebar-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          )}

          <div className="chat-list" onKeyDown={onListKeyDown}>
            {/* ERROR BEFORE EMPTY, and the order is the whole point. A failed
                list request left `chats` empty, so the next line announced
                "No chats yet" — an app telling a user their conversations are
                gone when nothing had happened to them. Nothing here deletes
                anything; the data is on the server. Say that, and offer the
                retry. */}
            {error && (
              <div className="chat-empty is-error" role="status">
                <p className="chat-empty-title">Couldn&rsquo;t load your chats.</p>
                <p className="chat-empty-body">
                  They are safe on the server. This request failed, not your data.
                </p>
                <button className="chat-empty-retry" onClick={onRetry}>
                  Try again
                </button>
              </div>
            )}

            {!error && chats.length === 0 && <div className="chat-empty">No chats yet</div>}

            {/* Distinct from "No chats yet" on purpose: one means start a chat,
                the other means change what you typed. */}
            {!error && chats.length > 0 && filtered.length === 0 && (
              <div className="chat-empty">No chats match “{query.trim()}”</div>
            )}

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

          {/* The footer said "ALOP-AI • Council of Minds" — the app's own name,
              to someone already inside the app. Linear and Raycast put the
              account here, which also gives the upgrade prompt a home that is
              not the top bar. */}
          <div className="sidebar-user">
            {userImageUrl ? (
              <img className="sidebar-user-avatar" src={userImageUrl} alt="" />
            ) : (
              <div className="sidebar-user-avatar is-fallback" aria-hidden="true">
                {(userName || "?").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <div className="sidebar-user-text">
              <span className="sidebar-user-name">{userName || "Signed in"}</span>
              <span className="sidebar-user-plan">{isPro ? "Pro" : "Free"}</span>
            </div>
            {!isPro && onUpgrade && (
              <button
                className="sidebar-upgrade"
                onClick={onUpgrade}
                aria-label="Upgrade to Pro"
                title="Upgrade to Pro"
              >
                <Icon name="crown" size={14} />
              </button>
            )}
          </div>
        </div>
      </nav>
    );
  }
);

ChatSidebar.displayName = "ChatSidebar";

export { ChatItem, groupChats, displayTitle };
export default ChatSidebar;
