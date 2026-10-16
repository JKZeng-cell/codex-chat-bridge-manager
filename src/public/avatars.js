const glyphs = {
  robot: '<rect x="5" y="7" width="14" height="12" rx="4"/><path d="M12 3v4M2 11v4m20-4v4M9 15h6"/><circle cx="9" cy="11" r=".8" fill="currentColor"/><circle cx="15" cy="11" r=".8" fill="currentColor"/>',
  orbit: '<rect x="4" y="5" width="16" height="15" rx="7"/><path d="M8 11h8M9 16h6M9 2v3m6-3v3"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>',
  pixel: '<path d="M8 4h8v3h4v12H4V7h4V4ZM1 10v6m22-6v6M8 15h8"/><path d="M8 10h2m4 0h2" stroke-width="3"/>',
  visor: '<path d="M5 19v-8a7 7 0 0 1 14 0v8M3 19h18M9 22h6"/><rect x="7" y="9" width="10" height="6" rx="3"/><path d="m13 11-2 2"/>',
  cat: '<path d="M5 10V3l6 5h2l6-5v7a8 8 0 1 1-14 0ZM3 14h4m10 0h4M3 17l4-1m10 0 4 1M10 17l2 2 2-2"/><circle cx="9" cy="12" r=".6" fill="currentColor"/><circle cx="15" cy="12" r=".6" fill="currentColor"/>',
  fox: '<path d="m3 3 9 5 9-5-2 13-7 5-7-5L3 3Zm2 8 7 7 7-7M10 18h4"/><path d="M7 11h2m6 0h2"/>',
  panda: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><ellipse cx="12" cy="13" rx="9" ry="8"/><ellipse cx="8" cy="12" rx="2" ry="3"/><ellipse cx="16" cy="12" rx="2" ry="3"/><path d="m10 17 2 1 2-1"/>',
  bear: '<circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><rect x="3" y="5" width="18" height="16" rx="8"/><ellipse cx="12" cy="16" rx="4" ry="3"/><path d="M12 15v3"/><circle cx="8" cy="11" r=".6" fill="currentColor"/><circle cx="16" cy="11" r=".6" fill="currentColor"/>',
  rocket: '<path d="M8 15c0-7 5-12 12-12 0 7-5 12-12 12Zm0 0-2 4m3-2-1 4M9 7H5l-3 6h6m9 2v4l-6 3v-7"/><circle cx="15" cy="8" r="2"/>',
  planet: '<circle cx="12" cy="12" r="7"/><ellipse cx="12" cy="12" rx="12" ry="3" transform="rotate(-30 12 12)"/><path d="m16 3 1-1M4 20l-1 1"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/><path d="M10 12h.1m3.8 0h.1M10 15c1 1 3 1 4 0"/>',
  moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11ZM17 3v4m-2-2h4M21 8v2m-1-1h2"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  bulb: '<path d="M8 15a7 7 0 1 1 8 0v3H8v-3ZM9 21h6M10 18v-6m4 6v-6m-4 0 2 2 2-2"/>',
  sprout: '<path d="M12 21V10M12 13C4 13 3 9 3 4c6 0 9 3 9 9Zm0-3c0-6 3-8 9-8 0 5-3 8-9 8ZM6 21h12"/>',
  palette: '<path d="M21 12a9 9 0 1 0-9 9h2a2 2 0 0 0 1-3.7 1.6 1.6 0 0 1 .8-3H18a3 3 0 0 0 3-2.3Z"/><circle cx="7" cy="9" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="7" r="1"/><circle cx="6" cy="14" r="1"/>'
};

export const AVATARS = Object.freeze([
  ["robot", "经典机器人", "neutral"], ["orbit", "圆圆", "blue"], ["pixel", "像素伙伴", "sage"], ["visor", "宇航员", "sand"],
  ["cat", "小猫", "sand"], ["fox", "小狐狸", "rose"], ["panda", "熊猫", "neutral"], ["bear", "小熊", "sand"],
  ["rocket", "火箭", "blue"], ["planet", "星球", "rose"], ["star", "星星", "sand"], ["moon", "月亮", "blue"],
  ["terminal", "终端", "neutral"], ["bulb", "灵感", "sand"], ["sprout", "新芽", "sage"], ["palette", "画家", "rose"]
].map(([id, label, tone]) => Object.freeze({ id, label, tone })));

const catalog = new Map(AVATARS.map((entry) => [entry.id, entry]));
const keyFor = (botId) => "bridge-avatar:" + botId;
export const normalizeAvatar = (id) => catalog.has(id) ? id : "robot";

export function renderAvatar(id = "robot") {
  const avatar = catalog.get(normalizeAvatar(id));
  return '<span class="avatar-art avatar-tone-' + avatar.tone + '" data-avatar-id="' + avatar.id + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">' + glyphs[avatar.id] + '</svg></span>';
}

export function createAvatarPreferences(storage) {
  const memory = new Map();
  const getStorage = () => storage ?? globalThis.localStorage;
  return {
    get(botId) {
      if (!botId) return "robot";
      if (memory.has(botId)) return memory.get(botId);
      try { return normalizeAvatar(getStorage().getItem(keyFor(botId))); } catch { return "robot"; }
    },
    set(botId, avatarId) {
      if (!botId) return false;
      const id = normalizeAvatar(avatarId);
      try {
        getStorage().setItem(keyFor(botId), id);
        memory.delete(botId);
        return true;
      } catch {
        memory.set(botId, id);
        return false;
      }
    }
  };
}

export function setupAvatarPicker({ doc = document, preferences, getBotId, onChange }) {
  const dialog = doc.getElementById("avatar-dialog");
  const grid = doc.getElementById("avatar-options");
  let targetId;
  function render() {
    const current = preferences.get(targetId);
    grid.innerHTML = AVATARS.map((avatar) => '<button type="button" class="avatar-option" data-avatar-choice="' + avatar.id + '" aria-pressed="' + (current === avatar.id) + '">' + renderAvatar(avatar.id) + '<span>' + avatar.label + '</span></button>').join("");
  }
  doc.getElementById("choose-avatar").addEventListener("click", () => {
    targetId = getBotId();
    if (!targetId) return;
    render();
    dialog.showModal();
    grid.querySelector('[aria-pressed="true"]').focus();
  });
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-avatar-choice]");
    if (!button || !targetId) return;
    const persisted = preferences.set(targetId, button.dataset.avatarChoice);
    render();
    dialog.close();
    onChange(persisted);
  });
  doc.getElementById("close-avatar").addEventListener("click", () => dialog.close());
}
