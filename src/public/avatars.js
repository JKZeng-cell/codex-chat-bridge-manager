const glyphs = {
  robot: '<rect x="5" y="7" width="14" height="12" rx="4"/><path d="M12 3v4M2 11v4m20-4v4M9 15h6"/><circle cx="9" cy="11" r=".8" fill="currentColor"/><circle cx="15" cy="11" r=".8" fill="currentColor"/>',
  orbit: '<path d="M9 3v2m6-2v2"/><rect x="4.5" y="5.5" width="15" height="15" rx="7"/><path d="M8 11h1m6 0h1M9 16c2 1 4 1 6 0"/>',
  pixel: '<path d="M8 4h8v3h4v12H4V7h4V4ZM1 10v6m22-6v6M8 15h8"/><path d="M8 10h2m4 0h2" stroke-width="3"/>',
  visor: '<path d="M5 18v-7a7 7 0 0 1 14 0v7M4 21h16"/><rect x="7.5" y="9" width="9" height="6" rx="3"/><path d="m13 11-2 2M8 18h8"/>',
  cat: '<path d="M5 10V4l5 3h4l5-3v6a8 8 0 1 1-14 0Z"/><path d="M8 12h.1m7.8 0h.1m-5 3h2m-1 0v2m-3 0c1 1 2 1 3 0 1 1 2 1 3 0M2 14h3m14 0h3M2 17h3m14 0h3"/>',
  fox: '<path d="m4 4 8 4 8-4-2 12-6 5-6-5L4 4Z"/><path d="m6 11 6 6 6-6M8 11h1m6 0h1m-5 6h2"/>',
  panda: '<path d="M4.5 8a2.8 2.8 0 1 1 4-3.5m7 0a2.8 2.8 0 1 1 4 3.5"/><ellipse cx="12" cy="13" rx="8.5" ry="8"/><ellipse cx="8.5" cy="11.5" rx="1.4" ry="2" transform="rotate(25 8.5 11.5)"/><ellipse cx="15.5" cy="11.5" rx="1.4" ry="2" transform="rotate(-25 15.5 11.5)"/><path d="m10.5 16 1.5 1 1.5-1"/>',
  bear: '<path d="M4.5 8a2.8 2.8 0 1 1 4-3.5m7 0a2.8 2.8 0 1 1 4 3.5"/><rect x="3.5" y="5" width="17" height="16" rx="8"/><path d="M8 11h.1m7.8 0h.1"/><ellipse cx="12" cy="16" rx="3.2" ry="2.5"/><path d="M11 15h2m-1 0v2"/>',
  rocket: '<path d="M8 15c0-6 5-11 12-12 0 7-5 12-11 12L8 15Zm1-7H5l-3 5h4m10 1v5l-5 3v-5M5 17l-2 3m4-2-1 3"/><circle cx="15" cy="8" r="1.8"/>',
  planet: '<path d="M5.5 14.5a7 7 0 0 1 12-6.8m1 1.8a7 7 0 0 1-12 6.8"/><ellipse cx="12" cy="12" rx="12" ry="2.7" transform="rotate(-30 12 12)"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/><path d="M9.5 12h.1m4.8 0h.1M10.5 15h3"/>',
  moon: '<path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11ZM17 3v4m-2-2h4M21 8v2m-1-1h2"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  bulb: '<path d="M8 15a7 7 0 1 1 8 0v3H8v-3ZM9 21h6M10 18v-6m4 6v-6m-4 0 2 2 2-2"/>',
  sprout: '<path d="M12 21V11M12 13C5 13 3 9 3 4c6 0 9 3 9 9Zm0-3c0-6 3-8 9-8 0 5-3 8-9 8ZM7 21h10"/>',
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
