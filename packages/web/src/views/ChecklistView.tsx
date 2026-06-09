import { useEffect, useState } from "react";
import type { Checklist, ChecklistItem, DirectoryUser } from "@app/shared";
import { useAuth } from "../state/useAuth";
import { fetchDirectory } from "../lib/rooms";
import { onTeamEvent } from "../lib/teamBus";
import {
  addItem,
  createChecklist,
  deleteChecklist,
  deleteItem,
  fetchChecklists,
  updateItem,
} from "../lib/checklist";

const ago = (t?: number) => {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

function AssigneeSelect({
  dir,
  value,
  onChange,
}: {
  dir: DirectoryUser[];
  value?: string;
  onChange: (handle: string, name: string) => void;
}) {
  return (
    <select
      className="ck-assignee"
      value={value ?? ""}
      onChange={(e) => {
        const u = dir.find((x) => x.handle === e.target.value);
        onChange(e.target.value, u?.displayName ?? "");
      }}
      title="Assign to"
    >
      <option value="">Unassigned</option>
      {dir.map((u) => (
        <option key={u.handle} value={u.handle}>
          {u.displayName}
        </option>
      ))}
    </select>
  );
}

function ItemRow({
  cid,
  item,
  dir,
  onChange,
}: {
  cid: string;
  item: ChecklistItem;
  dir: DirectoryUser[];
  onChange: () => void;
}) {
  const assignee = dir.find((u) => u.handle === item.assignee);
  return (
    <div className={`ck-item ${item.done ? "done" : ""}`}>
      <button
        className={`ck-check ${item.done ? "on" : ""}`}
        onClick={() => updateItem(cid, item.id, { done: !item.done }).then(onChange)}
        title={item.done ? "Mark not done" : "Mark done"}
      >
        {item.done ? "✓" : ""}
      </button>
      <div className="ck-body">
        <span className="ck-text">{item.text}</span>
        {item.done && item.doneBy && (
          <span className="ck-doneby">
            done by {item.doneBy} · {ago(item.doneAt)}
          </span>
        )}
      </div>
      {assignee ? (
        <span className="ck-pill" style={{ ["--c" as any]: assignee.color }} title={`Assigned to ${assignee.displayName}`}>
          <span className="ck-dot" style={{ background: assignee.color }} />
          {assignee.displayName.split(" ")[0]}
        </span>
      ) : null}
      <AssigneeSelect
        dir={dir}
        value={item.assignee}
        onChange={(handle, name) => updateItem(cid, item.id, { assignee: handle, assigneeName: name }).then(onChange)}
      />
      <button className="ck-x" onClick={() => deleteItem(cid, item.id).then(onChange)} title="Remove">
        ✕
      </button>
    </div>
  );
}

function ChecklistCard({ c, dir, onChange }: { c: Checklist; dir: DirectoryUser[]; onChange: () => void }) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const done = c.items.filter((i) => i.done).length;
  const pctDone = c.items.length ? Math.round((done / c.items.length) * 100) : 0;
  const add = async () => {
    if (!text.trim()) return;
    const name = dir.find((u) => u.handle === assignee)?.displayName;
    await addItem(c.id, text.trim(), assignee || undefined, name);
    setText("");
    onChange();
  };
  return (
    <div className="ck-card">
      <div className="ck-card-head">
        <h3>{c.title}</h3>
        <span className={`ck-prog ${pctDone === 100 ? "full" : ""}`}>
          {done}/{c.items.length} done
        </span>
        <button
          className="cc-icon-btn"
          onClick={() => {
            if (confirm(`Delete checklist "${c.title}"?`)) deleteChecklist(c.id).then(onChange);
          }}
          title="Delete checklist"
        >
          ✕
        </button>
      </div>
      <div className="ck-bar">
        <div className="ck-bar-fill" style={{ width: `${pctDone}%` }} />
      </div>

      <div className="ck-items">
        {c.items.length === 0 && <div className="cc-empty-sm">No tasks yet — add the first below.</div>}
        {c.items.map((it) => (
          <ItemRow key={it.id} cid={c.id} item={it} dir={dir} onChange={onChange} />
        ))}
      </div>

      <div className="ck-add">
        <input
          className="ck-in"
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <AssigneeSelect dir={dir} value={assignee} onChange={(h) => setAssignee(h)} />
        <button className="cc-chip sm" onClick={add}>
          + Add
        </button>
      </div>
    </div>
  );
}

/** Pre-stream checklists — run-of-show tasks with per-item assignees. Marking an
 * item done broadcasts a team notification to everyone. */
export function ChecklistView() {
  const { user } = useAuth();
  const [lists, setLists] = useState<Checklist[]>([]);
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = () => fetchChecklists().then(setLists);
  useEffect(() => {
    load();
    fetchDirectory().then(setDir);
    // any broadcast team event (incl. our own actions) refreshes the lists for all clients
    return onTeamEvent(() => load());
  }, []);

  const create = async () => {
    const t = newTitle.trim() || "Pre-stream checklist";
    await createChecklist(t);
    setNewTitle("");
    load();
  };

  return (
    <div className="ck-view">
      <div className="ck-top">
        <div>
          <h2>Run of Show</h2>
          <p className="cc-empty-sm">
            Pre-stream checklists with assignees. Tick a task and {user ? "the team" : "everyone"} gets a live notification.
          </p>
        </div>
        <div className="ck-new">
          <input
            className="ck-in"
            placeholder="New checklist title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="cc-chip active" onClick={create}>
            + New checklist
          </button>
        </div>
      </div>

      <div className="ck-grid">
        {lists.map((c) => (
          <ChecklistCard key={c.id} c={c} dir={dir} onChange={load} />
        ))}
        {lists.length === 0 && <div className="cc-empty-sm">No checklists yet — create one to get started.</div>}
      </div>
    </div>
  );
}
