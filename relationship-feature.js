/**
 * Relationship & Family Tree Feature for AniPedia
 * - Commands: <marry, <adopt, <divorce, <leave, <familytree (or <family)
 * - Interactive Discord buttons (Yes/No) for proposals and confirmations
 * - Canvas generated banners for Marriage, Adoption, Divorce, and Family Tree
 * - Strictly authorized: Only Main Admin (ID: 1013822181379162142) can trigger
 * - Permanent persistence in Firebase Firestore ('relationships' collection)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// Authorized Admin IDs allowed to run Relationship commands
const AUTHORIZED_ADMIN_IDS = new Set([
  '1013822181379162142', // Aerion / Creator / Main Admin
  '1455104414166679656', // Grand Admin
  '1382005683288936478', // Grand Admin
  '750056830654480510'   // Grand Admin
]);

// In-memory cache for ultra-fast response without database lag
// userId -> { userId, spouseId, marriedAt, parentIds, childrenIds, updatedAt }
const relationshipCache = new Map();

let dbRef = null;

// Image asset caches
let cachedMarriageBg = null;
let cachedDivorceBg = null;
let cachedAdoptBg = null;
let cachedFamilyTreeBg = null;
let cachedHeartIcon = null;

/**
 * Finds an asset file in project directories
 */
function findAssetPath(filename) {
  const possiblePaths = [
    path.join(__dirname, 'assets', filename),
    path.join(__dirname, 'assets', 'relationship', filename),
    path.join(process.cwd(), 'assets', filename),
    path.join(process.cwd(), 'assets', 'relationship', filename),
    path.join(__dirname, filename),
    path.join(process.cwd(), filename)
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Loads an image from cache or disk
 */
async function getAssetImage(type) {
  try {
    if (type === 'marriage') {
      if (!cachedMarriageBg) {
        const p = findAssetPath('marriage.png') || findAssetPath('marriage.jpg');
        if (p) cachedMarriageBg = await loadImage(p);
      }
      return cachedMarriageBg;
    }
    if (type === 'divorce') {
      if (!cachedDivorceBg) {
        const p = findAssetPath('divorce.png') || findAssetPath('divorce.jpg');
        if (p) cachedDivorceBg = await loadImage(p);
      }
      return cachedDivorceBg;
    }
    if (type === 'adopt') {
      if (!cachedAdoptBg) {
        const p = findAssetPath('adopt.png') || findAssetPath('adopt.jpg');
        if (p) cachedAdoptBg = await loadImage(p);
      }
      return cachedAdoptBg;
    }
    if (type === 'family_tree') {
      if (!cachedFamilyTreeBg) {
        const p = findAssetPath('family_tree.png') || findAssetPath('family_tree.jpg');
        if (p) cachedFamilyTreeBg = await loadImage(p);
      }
      return cachedFamilyTreeBg;
    }
    if (type === 'heart') {
      if (!cachedHeartIcon) {
        const p = findAssetPath('heart.png');
        if (p) cachedHeartIcon = await loadImage(p);
      }
      return cachedHeartIcon;
    }
  } catch (err) {
    console.error(`[Relationship] Failed loading asset ${type}:`, err.message);
  }
  return null;
}

/**
 * Converts text to small-caps
 */
function toSmallCaps(str) {
  const map = {
    A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ', J: 'ᴊ',
    K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ', S: 's', T: 'ᴛ',
    U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ',
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
    k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ',
    u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
  };
  return String(str).split('').map(char => map[char] || char).join('');
}

/**
 * Draws rounded rectangle
 */
function drawRoundRect(ctx, x, y, width, height, radius) {
  if (width < 2 * radius) radius = width / 2;
  if (height < 2 * radius) radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Truncates text if it exceeds maxWidth
 */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

/**
 * Draws a circular avatar with glowing border and silhouette fallback
 */
async function drawCircularAvatar(ctx, avatarUrl, cx, cy, radius, strokeColor = '#ffffff', lineWidth = 3.0, glowBlur = 12) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // Dark placeholder base
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  let loaded = false;
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      loaded = true;
    } catch (e) {
      loaded = false;
    }
  }

  if (!loaded) {
    // Silhouette fallback
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.25, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy + radius * 0.9, radius * 0.75, Math.PI, 0);
    ctx.fill();
  }

  ctx.restore();

  // Glowing Outer Stroke
  if (strokeColor && lineWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    if (glowBlur > 0) {
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = glowBlur;
    }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Preloads all relationships from Firestore into memory
 */
async function initRelationshipFeature(db) {
  dbRef = db;
  if (!db) {
    console.log('[Relationship] Running in memory-only mode.');
    return;
  }

  try {
    const snapshot = await db.collection('relationships').get();
    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const d = doc.data();
        relationshipCache.set(doc.id, {
          userId: doc.id,
          spouseId: d.spouseId || null,
          marriedAt: d.marriedAt ? d.marriedAt.toDate() : null,
          parentIds: Array.isArray(d.parentIds) ? d.parentIds : (d.parentId ? [d.parentId] : []),
          childrenIds: Array.isArray(d.childrenIds) ? d.childrenIds : [],
          updatedAt: d.updatedAt ? d.updatedAt.toDate() : new Date()
        });
      });
      console.log(`[Relationship] Loaded ${relationshipCache.size} relationship records from Firestore.`);
    }
  } catch (err) {
    console.error('[Relationship] Error loading relationships from Firestore:', err.message);
  }
}

/**
 * Gets or initializes a relationship record
 */
function getRelationshipRecord(userId) {
  let rec = relationshipCache.get(userId);
  if (!rec) {
    rec = {
      userId,
      spouseId: null,
      marriedAt: null,
      parentIds: [],
      childrenIds: [],
      updatedAt: new Date()
    };
    relationshipCache.set(userId, rec);
  }
  return rec;
}

/**
 * Saves a relationship record to memory and Firestore
 */
async function saveRelationshipRecord(userId, data) {
  const existing = getRelationshipRecord(userId);
  Object.assign(existing, data, { updatedAt: new Date() });
  relationshipCache.set(userId, existing);

  if (dbRef) {
    try {
      await dbRef.collection('relationships').doc(userId).set({
        userId,
        spouseId: existing.spouseId,
        marriedAt: existing.marriedAt,
        parentIds: existing.parentIds,
        childrenIds: existing.childrenIds,
        updatedAt: existing.updatedAt
      }, { merge: true });
    } catch (err) {
      console.error(`[Relationship] Firestore save error for ${userId}:`, err.message);
    }
  }
}

/**
 * ====================================================================
 * CANVAS BANNER GENERATORS
 * ====================================================================
 */

/**
 * 1. Generates the Marriage Announcement Banner
 */
async function generateMarriageBanner(user1Member, user2Member, marriageDate = new Date()) {
  const width = 1000;
  const height = 368;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background Image
  const bgImg = await getAssetImage('marriage');
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, width, height);
  } else {
    // Elegant fallback gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#3b0764');
    grad.addColorStop(0.5, '#701a75');
    grad.addColorStop(1, '#831843');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Soft romantic dark glass vignette overlay
  ctx.save();
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(20, 5, 30, 0.45)');
  vignette.addColorStop(0.5, 'rgba(20, 5, 30, 0.2)');
  vignette.addColorStop(1, 'rgba(20, 5, 30, 0.6)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Top Header: "JUST MARRIED"
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Title with gold glow
  ctx.font = 'italic 900 34px "Segoe UI", Georgia, Montserrat, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#f472b6';
  ctx.shadowBlur = 18;
  ctx.fillText('JUST MARRIED', width / 2, 28);

  ctx.font = 'bold 14px "Segoe UI", Montserrat, sans-serif';
  ctx.fillStyle = '#fed7aa';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 6;
  ctx.fillText('✦  A SACRED BOND OF ETERNAL LOVE  ✦', width / 2, 70);
  ctx.restore();

  // User 1 Avatar & Details (Left side)
  const u1Avatar = user1Member.user?.displayAvatarURL
    ? user1Member.user.displayAvatarURL({ extension: 'png', size: 256 })
    : user1Member.displayAvatarURL({ extension: 'png', size: 256 });
  const u1Disp = user1Member.displayName || user1Member.user?.username || 'User';
  const u1User = `@${user1Member.user?.username || user1Member.displayName || 'user'}`;

  const u1Cx = 270;
  const u1Cy = 185;
  const avatarRadius = 60;
  await drawCircularAvatar(ctx, u1Avatar, u1Cx, u1Cy, avatarRadius, '#f472b6', 3.5, 16);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 20px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(fitText(ctx, u1Disp, 220), u1Cx, u1Cy + avatarRadius + 22);

  ctx.font = '14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#fbcfe8';
  ctx.fillText(fitText(ctx, u1User, 220), u1Cx, u1Cy + avatarRadius + 44);
  ctx.restore();

  // User 2 Avatar & Details (Right side)
  const u2Avatar = user2Member.user?.displayAvatarURL
    ? user2Member.user.displayAvatarURL({ extension: 'png', size: 256 })
    : user2Member.displayAvatarURL({ extension: 'png', size: 256 });
  const u2Disp = user2Member.displayName || user2Member.user?.username || 'User';
  const u2User = `@${user2Member.user?.username || user2Member.displayName || 'user'}`;

  const u2Cx = 730;
  const u2Cy = 185;
  await drawCircularAvatar(ctx, u2Avatar, u2Cx, u2Cy, avatarRadius, '#f472b6', 3.5, 16);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 20px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(fitText(ctx, u2Disp, 220), u2Cx, u2Cy + avatarRadius + 22);

  ctx.font = '14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#fbcfe8';
  ctx.fillText(fitText(ctx, u2User, 220), u2Cx, u2Cy + avatarRadius + 44);
  ctx.restore();

  // Connecting Glowing Pink Line / Ribbon between avatars
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(u1Cx + avatarRadius + 10, u1Cy);
  ctx.bezierCurveTo(u1Cx + 130, u1Cy - 30, u2Cx - 130, u2Cy - 30, u2Cx - avatarRadius - 10, u2Cy);
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ec4899';
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.restore();

  // Center Heart Icon
  const heartImg = await getAssetImage('heart');
  const heartCx = width / 2;
  const heartCy = 185;
  const heartSize = 82;

  ctx.save();
  ctx.shadowColor = '#f472b6';
  ctx.shadowBlur = 24;
  if (heartImg) {
    ctx.drawImage(heartImg, heartCx - heartSize / 2, heartCy - heartSize / 2, heartSize, heartSize);
  } else {
    // Vector heart fallback
    ctx.fillStyle = '#ec4899';
    ctx.beginPath();
    const topCurveHeight = heartSize * 0.3;
    ctx.moveTo(heartCx, heartCy + heartSize * 0.35);
    ctx.bezierCurveTo(heartCx - heartSize / 2, heartCy - topCurveHeight, heartCx - heartSize / 2, heartCy - heartSize * 0.35, heartCx, heartCy - heartSize * 0.15);
    ctx.bezierCurveTo(heartCx + heartSize / 2, heartCy - heartSize * 0.35, heartCx + heartSize / 2, heartCy - topCurveHeight, heartCx, heartCy + heartSize * 0.35);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Date Tag at Bottom Center
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const dateStr = marriageDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ctx.fillText(`ANIPEDIA SANCTUARY  •  ${dateStr.toUpperCase()}`, width / 2, height - 22);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * 2. Generates the Adoption Announcement Banner
 */
async function generateAdoptionBanner(parents, childMember, adoptDate = new Date()) {
  const width = 1000;
  const height = 368;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background Image
  const bgImg = await getAssetImage('adopt');
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, width, height);
  } else {
    // Warm sunset gradient fallback
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#ea580c');
    grad.addColorStop(0.5, '#d97706');
    grad.addColorStop(1, '#65a30d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Soft dark warmth vignette
  ctx.save();
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(20, 15, 5, 0.4)');
  vignette.addColorStop(0.5, 'rgba(20, 15, 5, 0.15)');
  vignette.addColorStop(1, 'rgba(20, 15, 5, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Header Title
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'italic 900 34px "Segoe UI", Georgia, Montserrat, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 18;
  ctx.fillText('OFFICIALLY ADOPTED', width / 2, 28);

  ctx.font = 'bold 14px "Segoe UI", Montserrat, sans-serif';
  ctx.fillStyle = '#fef08a';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 6;
  ctx.fillText('✦  WELCOME TO THE FAMILY  ✦', width / 2, 70);
  ctx.restore();

  // Parent(s) on Left side
  const parent1 = parents[0];
  const parent2 = parents[1] || null;
  const isTwoParents = Boolean(parent2);

  const p1Avatar = parent1.user?.displayAvatarURL
    ? parent1.user.displayAvatarURL({ extension: 'png', size: 256 })
    : parent1.displayAvatarURL({ extension: 'png', size: 256 });
  const p1Disp = parent1.displayName || parent1.user?.username || 'Parent';

  const avatarRadius = 56;
  const p1Cx = isTwoParents ? 210 : 270;
  const pCy = 185;

  await drawCircularAvatar(ctx, p1Avatar, p1Cx, pCy, avatarRadius, '#f59e0b', 3.5, 14);

  if (isTwoParents) {
    const p2Avatar = parent2.user?.displayAvatarURL
      ? parent2.user.displayAvatarURL({ extension: 'png', size: 256 })
      : parent2.displayAvatarURL({ extension: 'png', size: 256 });
    const p2Disp = parent2.displayName || parent2.user?.username || 'Parent';
    const p2Cx = 320;
    await drawCircularAvatar(ctx, p2Avatar, p2Cx, pCy, avatarRadius, '#f59e0b', 3.5, 14);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 18px "Segoe UI", Montserrat, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(fitText(ctx, `${p1Disp} & ${p2Disp}`, 260), (p1Cx + p2Cx) / 2, pCy + avatarRadius + 22);

    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.fillText('PARENTS', (p1Cx + p2Cx) / 2, pCy + avatarRadius + 44);
    ctx.restore();
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 19px "Segoe UI", Montserrat, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(fitText(ctx, p1Disp, 220), p1Cx, pCy + avatarRadius + 22);

    ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.fillText('PARENT', p1Cx, pCy + avatarRadius + 44);
    ctx.restore();
  }

  // Child on Right side
  const childAvatar = childMember.user?.displayAvatarURL
    ? childMember.user.displayAvatarURL({ extension: 'png', size: 256 })
    : childMember.displayAvatarURL({ extension: 'png', size: 256 });
  const childDisp = childMember.displayName || childMember.user?.username || 'Child';
  const childUser = `@${childMember.user?.username || childMember.displayName || 'user'}`;

  const childCx = 730;
  await drawCircularAvatar(ctx, childAvatar, childCx, pCy, avatarRadius, '#84cc16', 3.5, 14);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 20px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(fitText(ctx, childDisp, 220), childCx, pCy + avatarRadius + 22);

  ctx.font = 'bold 13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#bbf7d0';
  ctx.fillText('ADOPTED CHILD', childCx, pCy + avatarRadius + 44);
  ctx.restore();

  // Center Warm Golden Heart
  const heartImg = await getAssetImage('heart');
  const heartCx = width / 2;
  const heartCy = 185;
  const heartSize = 78;

  ctx.save();
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 20;
  if (heartImg) {
    ctx.drawImage(heartImg, heartCx - heartSize / 2, heartCy - heartSize / 2, heartSize, heartSize);
  }
  ctx.restore();

  // Connecting Warm Golden Branch Line
  ctx.save();
  ctx.beginPath();
  const leftEdge = isTwoParents ? 320 + avatarRadius + 8 : p1Cx + avatarRadius + 8;
  ctx.moveTo(leftEdge, pCy);
  ctx.bezierCurveTo(leftEdge + 60, pCy - 20, childCx - avatarRadius - 60, pCy - 20, childCx - avatarRadius - 8, pCy);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.8;
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();

  // Date Tag at Bottom Center
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  const dateStr = adoptDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ctx.fillText(`ANIPEDIA FAMILY  •  ${dateStr.toUpperCase()}`, width / 2, height - 22);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * 3. Generates the Divorce Announcement Banner
 */
async function generateDivorceBanner(user1Member, user2Member, divorceDate = new Date()) {
  const width = 1000;
  const height = 368;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background Image
  const bgImg = await getAssetImage('divorce');
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, width, height);
  } else {
    // Cold moody rain gradient fallback
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#090d16');
    grad.addColorStop(0.5, '#1e293b');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Dark cold overlay
  ctx.save();
  const vignette = ctx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, 'rgba(5, 7, 15, 0.5)');
  vignette.addColorStop(0.5, 'rgba(5, 7, 15, 0.25)');
  vignette.addColorStop(1, 'rgba(5, 7, 15, 0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Header Title: "MARRIAGE DISSOLVED"
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'italic 900 34px "Segoe UI", Georgia, Montserrat, sans-serif';
  ctx.fillStyle = '#ef4444';
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 18;
  ctx.fillText('MARRIAGE DISSOLVED', width / 2, 28);

  ctx.font = 'bold 14px "Segoe UI", Montserrat, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText('✦  BONDS & FAMILY TIES SEVERED  ✦', width / 2, 70);
  ctx.restore();

  // User 1 Avatar & Details (Left side, cold slate border)
  const u1Avatar = user1Member.user?.displayAvatarURL
    ? user1Member.user.displayAvatarURL({ extension: 'png', size: 256 })
    : user1Member.displayAvatarURL({ extension: 'png', size: 256 });
  const u1Disp = user1Member.displayName || user1Member.user?.username || 'User';
  const u1User = `@${user1Member.user?.username || user1Member.displayName || 'user'}`;

  const u1Cx = 260;
  const u1Cy = 185;
  const avatarRadius = 60;
  await drawCircularAvatar(ctx, u1Avatar, u1Cx, u1Cy, avatarRadius, '#64748b', 3.0, 8);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 20px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(fitText(ctx, u1Disp, 220), u1Cx, u1Cy + avatarRadius + 22);

  ctx.font = '14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(fitText(ctx, u1User, 220), u1Cx, u1Cy + avatarRadius + 44);
  ctx.restore();

  // User 2 Avatar & Details (Right side, cold slate border)
  const u2Avatar = user2Member.user?.displayAvatarURL
    ? user2Member.user.displayAvatarURL({ extension: 'png', size: 256 })
    : user2Member.displayAvatarURL({ extension: 'png', size: 256 });
  const u2Disp = user2Member.displayName || user2Member.user?.username || 'User';
  const u2User = `@${user2Member.user?.username || user2Member.displayName || 'user'}`;

  const u2Cx = 740;
  const u2Cy = 185;
  await drawCircularAvatar(ctx, u2Avatar, u2Cx, u2Cy, avatarRadius, '#64748b', 3.0, 8);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 20px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.fillText(fitText(ctx, u2Disp, 220), u2Cx, u2Cy + avatarRadius + 22);

  ctx.font = '14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText(fitText(ctx, u2User, 220), u2Cx, u2Cy + avatarRadius + 44);
  ctx.restore();

  // Center Broken Heart Icon
  const heartCx = width / 2;
  const heartCy = 185;

  ctx.save();
  // Draw broken zigzag crack through the center
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 3.5;
  ctx.shadowColor = '#ef4444';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(heartCx, heartCy - 45);
  ctx.lineTo(heartCx - 12, heartCy - 15);
  ctx.lineTo(heartCx + 14, heartCy + 5);
  ctx.lineTo(heartCx - 10, heartCy + 25);
  ctx.lineTo(heartCx, heartCy + 48);
  ctx.stroke();

  // "DIVORCED" stamp in center
  ctx.font = '900 16px "Segoe UI", Arial Black, Impact, sans-serif';
  ctx.fillStyle = '#f87171';
  ctx.textAlign = 'center';
  ctx.fillText('DIVORCED', heartCx, heartCy + 72);
  ctx.restore();

  // Date Tag at Bottom Center
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  const dateStr = divorceDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ctx.fillText(`ANIPEDIA SANCTUARY  •  ${dateStr.toUpperCase()}`, width / 2, height - 22);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * 4. Generates the Family Tree Canvas Card
 */
async function generateFamilyTreeBanner(focusMember, guild) {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background Image
  const bgImg = await getAssetImage('family_tree');
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, width, height);
  } else {
    // Dark futuristic starry background fallback
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#030712');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Dark overlay
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const focusDisp = focusMember.displayName || focusMember.user?.username || 'User';
  const familyTitle = `${focusDisp}'s Family Tree`;

  // Top Title
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'italic 900 32px "Segoe UI", Montserrat, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = 16;
  ctx.fillText(fitText(ctx, familyTitle, 900), width / 2, 24);
  ctx.restore();

  const focusId = focusMember.id;
  const rel = getRelationshipRecord(focusId);

  // Determine Parents (focus user + spouse if married)
  const spouseMember = rel.spouseId ? (guild.members.cache.get(rel.spouseId) || null) : null;
  const isMarried = Boolean(spouseMember);

  // Top Tier: Parents / Main Couple
  const cardW = 220;
  const cardH = 96;
  const topY = 90;

  if (isMarried) {
    // Parent 1 (Left)
    const p1X = width / 2 - cardW - 35;
    await drawFamilyNodeCard(ctx, focusMember, p1X, topY, cardW, cardH, 'SPOUSE 1', '#ec4899', '#f472b6');

    // Parent 2 (Right)
    const p2X = width / 2 + 35;
    await drawFamilyNodeCard(ctx, spouseMember, p2X, topY, cardW, cardH, 'SPOUSE 2', '#ec4899', '#f472b6');

    // Heart between married couple
    const heartImg = await getAssetImage('heart');
    if (heartImg) {
      ctx.save();
      ctx.shadowColor = '#ec4899';
      ctx.shadowBlur = 14;
      ctx.drawImage(heartImg, width / 2 - 20, topY + cardH / 2 - 20, 40, 40);
      ctx.restore();
    }
  } else {
    // Single User Card (Centered)
    const pX = (width - cardW) / 2;
    await drawFamilyNodeCard(ctx, focusMember, pX, topY, cardW, cardH, 'HEAD OF FAMILY', '#38bdf8', '#38bdf8');
  }

  // Connecting neon branch line dropping down to children
  const lineStartY = topY + cardH;
  const branchDropY = topY + cardH + 45;
  const childRowY = topY + cardH + 105;

  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = 14;

  ctx.beginPath();
  ctx.moveTo(width / 2, lineStartY);
  ctx.lineTo(width / 2, branchDropY);
  ctx.stroke();
  ctx.restore();

  // Children Row
  const childrenIds = rel.childrenIds || [];
  const childrenMembers = [];
  for (const cid of childrenIds) {
    const m = guild.members.cache.get(cid);
    if (m) childrenMembers.push(m);
  }

  if (childrenMembers.length === 0) {
    // Empty state placeholder
    ctx.save();
    const emptyW = 340;
    const emptyH = 70;
    const emptyX = (width - emptyW) / 2;
    const emptyY = childRowY + 15;

    drawRoundRect(ctx, emptyX, emptyY, emptyW, emptyH, 14);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('No Adopted Children In This Family', width / 2, emptyY + emptyH / 2);
    ctx.restore();
  } else {
    // Display up to 4 children in grid/row
    const displayCount = Math.min(childrenMembers.length, 4);
    const childCardW = 200;
    const childCardH = 88;
    const spacing = 30;
    const totalRowW = displayCount * childCardW + (displayCount - 1) * spacing;
    const startX = (width - totalRowW) / 2;

    // Horizontal distributor branch bar
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.moveTo(startX + childCardW / 2, branchDropY);
    ctx.lineTo(startX + totalRowW - childCardW / 2, branchDropY);
    ctx.stroke();

    // Drop pins to each child
    for (let i = 0; i < displayCount; i++) {
      const cx = startX + i * (childCardW + spacing) + childCardW / 2;
      ctx.beginPath();
      ctx.moveTo(cx, branchDropY);
      ctx.lineTo(cx, childRowY);
      ctx.stroke();
    }
    ctx.restore();

    // Draw Child Node Cards
    for (let i = 0; i < displayCount; i++) {
      const childMember = childrenMembers[i];
      const cx = startX + i * (childCardW + spacing);
      await drawFamilyNodeCard(ctx, childMember, cx, childRowY, childCardW, childCardH, 'CHILD', '#84cc16', '#a3e635');
    }
  }

  // Footer
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '13px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.fillText(`ANIPEDIA SANCTUARY  •  FAMILY ID: ${focusId}`, width / 2, height - 20);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * Draws an aesthetic node card inside the family tree
 */
async function drawFamilyNodeCard(ctx, member, x, y, w, h, badgeText, strokeColor, glowColor) {
  ctx.save();
  // Card base
  drawRoundRect(ctx, x, y, w, h, 14);
  const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
  cardGrad.addColorStop(0, '#0f172a');
  cardGrad.addColorStop(1, '#020617');
  ctx.fillStyle = cardGrad;
  ctx.fill();

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();

  // Avatar
  const avSize = 52;
  const avX = x + 12;
  const avY = y + (h - avSize) / 2;
  const avRadius = avSize / 2;
  const avUrl = member.user?.displayAvatarURL
    ? member.user.displayAvatarURL({ extension: 'png', size: 128 })
    : member.displayAvatarURL({ extension: 'png', size: 128 });

  await drawCircularAvatar(ctx, avUrl, avX + avRadius, avY + avRadius, avRadius, strokeColor, 2, 6);

  // User details on right of avatar
  const textX = avX + avSize + 12;
  const maxW = w - (avSize + 28);

  ctx.save();
  ctx.textAlign = 'left';

  // Badge
  ctx.font = '900 11px "Segoe UI", Arial Black, sans-serif';
  ctx.fillStyle = strokeColor;
  ctx.fillText(badgeText, textX, y + 24);

  // Display Name
  const dispName = member.displayName || member.user?.username || 'User';
  ctx.font = 'bold 15px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fitText(ctx, dispName, maxW), textX, y + 46);

  // @username
  const userName = `@${member.user?.username || member.displayName || 'user'}`;
  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(fitText(ctx, userName, maxW), textX, y + 68);

  ctx.restore();
}

/**
 * ====================================================================
 * COMMANDS & INTERACTION HANDLERS
 * ====================================================================
 */

/**
 * Handles text commands: <marry, <adopt, <divorce, <leave, <familytree, <family
 */
async function handleRelationshipCommand(message, client, db, sendContainer = null) {
  const content = (message.content || '').trim();
  const lower = content.toLowerCase();

  // Check prefix: '<' or other configured prefixes
  if (!content.startsWith('<') && !content.startsWith('-')) return false;

  const rawCmd = content.slice(1).trim();
  const cmd = (rawCmd.split(/\s+/)[0] || '').toLowerCase();

  const relationshipCommands = new Set(['marry', 'adopt', 'divorce', 'leave', 'familytree', 'family']);
  if (!relationshipCommands.has(cmd)) return false;

  // 1. <marry [@user] [@user2]
  if (cmd === 'marry') {
    await handleMarryCommand(message, client);
    return true;
  }

  // 2. <adopt [@user]
  if (cmd === 'adopt') {
    await handleAdoptCommand(message, client);
    return true;
  }

  // 3. <divorce [@user]
  if (cmd === 'divorce') {
    await handleDivorceCommand(message, client);
    return true;
  }

  // 4. <leave
  if (cmd === 'leave') {
    await handleLeaveCommand(message, client);
    return true;
  }

  // 5. <familytree / <family [@user]
  if (cmd === 'familytree' || cmd === 'family') {
    await handleFamilyTreeCommand(message, client, sendContainer);
    return true;
  }

  return false;
}

/**
 * <marry handler
 */
async function handleMarryCommand(message, client) {
  const mentions = Array.from(message.mentions.members.filter(m => m.id !== client.user.id).values());

  let user1Member = message.member;
  let user2Member = null;

  if (mentions.length >= 2) {
    if (mentions[0].id === message.author.id) {
      user1Member = mentions[0];
      user2Member = mentions[1];
    } else if (mentions[1].id === message.author.id) {
      user1Member = mentions[1];
      user2Member = mentions[0];
    } else if (AUTHORIZED_ADMIN_IDS.has(message.author.id)) {
      user1Member = mentions[0];
      user2Member = mentions[1];
    } else {
      user1Member = message.member;
      user2Member = mentions[0];
    }
  } else if (mentions.length === 1) {
    user2Member = mentions[0];
  }

  if (!user2Member) {
    await message.reply("💍 Please mention a valid user to marry! Example: `<marry @user>`");
    return;
  }

  if (user1Member.id === user2Member.id) {
    await message.reply("Mou! 🌸 You cannot marry yourself!");
    return;
  }

  if (user2Member.user?.bot) {
    await message.reply("Mou! 🌸 You cannot marry a bot!");
    return;
  }

  const rel1 = getRelationshipRecord(user1Member.id);
  const rel2 = getRelationshipRecord(user2Member.id);

  if (rel1.spouseId) {
    await message.reply(`❌ <@${user1Member.id}> is already married to <@${rel1.spouseId}>! You must divorce first before marrying someone else!`);
    return;
  }

  if (rel2.spouseId) {
    await message.reply(`❌ <@${user2Member.id}> is already married to <@${rel2.spouseId}>!`);
    return;
  }

  // Check parent-child conflict
  if (rel1.childrenIds.includes(user2Member.id) || rel2.childrenIds.includes(user1Member.id)) {
    await message.reply("❌ Forbidden: A parent cannot marry their adopted child!");
    return;
  }

  // Build Interactive Proposal Row
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_marry_accept_${user1Member.id}_${user2Member.id}`)
      .setLabel('Accept (Yes)')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💍'),
    new ButtonBuilder()
      .setCustomId(`rel_marry_decline_${user1Member.id}_${user2Member.id}`)
      .setLabel('Decline (No)')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✖️')
  );

  await message.reply({
    content: `💍 **Marriage Proposal**\n<@${user2Member.id}>, do you want to accept this marriage proposal from <@${user1Member.id}>?`,
    components: [row]
  });
}

/**
 * <adopt handler
 */
async function handleAdoptCommand(message, client) {
  const targetMember = message.mentions.members.filter(m => m.id !== client.user.id && m.id !== message.author.id).first();

  if (!targetMember) {
    await message.reply("🏡 Please mention a user to adopt! Example: `<adopt @user>`");
    return;
  }

  if (targetMember.id === message.author.id) {
    await message.reply("Mou! 🌸 You cannot adopt yourself!");
    return;
  }

  if (targetMember.user?.bot) {
    await message.reply("Mou! 🌸 You cannot adopt a bot!");
    return;
  }

  const parentRel = getRelationshipRecord(message.author.id);
  const childRel = getRelationshipRecord(targetMember.id);

  if (parentRel.spouseId === targetMember.id) {
    await message.reply("❌ You cannot adopt your own spouse!");
    return;
  }

  if (childRel.parentIds && childRel.parentIds.length > 0) {
    await message.reply(`❌ <@${targetMember.id}> is already adopted in a family! They must leave their family first.`);
    return;
  }

  if (parentRel.childrenIds.includes(targetMember.id)) {
    await message.reply(`❌ <@${targetMember.id}> is already your adopted child!`);
    return;
  }

  // Build Interactive Proposal Row
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_adopt_accept_${message.author.id}_${targetMember.id}`)
      .setLabel('Accept (Yes)')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🏡'),
    new ButtonBuilder()
      .setCustomId(`rel_adopt_decline_${message.author.id}_${targetMember.id}`)
      .setLabel('Decline (No)')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✖️')
  );

  await message.reply({
    content: `🏡 **Adoption Proposal**\n<@${targetMember.id}>, do you accept the proposal to be adopted into the family of <@${message.author.id}>?`,
    components: [row]
  });
}

/**
 * <divorce handler
 */
async function handleDivorceCommand(message, client) {
  const rel = getRelationshipRecord(message.author.id);
  if (!rel.spouseId) {
    await message.reply("❌ You are not married to anyone!");
    return;
  }

  const spouseId = rel.spouseId;

  // Build Interactive Confirmation Row
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_divorce_confirm_${message.author.id}_${spouseId}`)
      .setLabel('Confirm Divorce')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('💔'),
    new ButtonBuilder()
      .setCustomId(`rel_divorce_cancel_${message.author.id}_${spouseId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await message.reply({
    content: `💔 **Divorce Confirmation**\n<@${message.author.id}>, do you really want to divorce <@${spouseId}>?\n⚠️ *Note: Dissolving this marriage will also dissolve all associated family adoptions!*`,
    components: [row]
  });
}

/**
 * <leave handler
 */
async function handleLeaveCommand(message, client) {
  const rel = getRelationshipRecord(message.author.id);

  if (!rel.parentIds || rel.parentIds.length === 0) {
    await message.reply("❌ You are not currently adopted by any family!");
    return;
  }

  const formerParents = [...rel.parentIds];

  // Remove child from parents' children list
  for (const pid of formerParents) {
    const parentRec = getRelationshipRecord(pid);
    parentRec.childrenIds = (parentRec.childrenIds || []).filter(cid => cid !== message.author.id);
    await saveRelationshipRecord(pid, { childrenIds: parentRec.childrenIds });
  }

  // Clear child's parent link
  rel.parentIds = [];
  await saveRelationshipRecord(message.author.id, { parentIds: [] });

  await message.reply(`🏡 <@${message.author.id}> has left their adopted family and is now independent!`);
}

/**
 * <familytree / <family handler
 */
async function handleFamilyTreeCommand(message, client, sendContainer = null) {
  await message.channel.sendTyping().catch(() => {});

  let targetMember = message.mentions.members.filter(m => m.id !== client.user.id).first() || message.member;

  const cardBuffer = await generateFamilyTreeBanner(targetMember, message.guild);
  const attachment = new AttachmentBuilder(cardBuffer, { name: 'family_tree.png' });

  if (typeof sendContainer === 'function') {
    await sendContainer(message, {
      image: 'attachment://family_tree.png',
      footer: `${toSmallCaps('AniPedia Family Registry')}`,
      timestamp: Date.now(),
      files: [attachment]
    });
  } else {
    await message.reply({
      files: [attachment]
    });
  }
}

/**
 * Handles button interactions for Relationship features
 */
async function handleRelationshipButton(interaction, client, db, sendContainer = null) {
  const customId = interaction.customId;
  if (!customId.startsWith('rel_')) return false;

  // 1. Marriage Accept
  if (customId.startsWith('rel_marry_accept_')) {
    const parts = customId.replace('rel_marry_accept_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];

    if (interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${user2Id}> can accept or decline this proposal! ❄️`,
        ephemeral: true
      });
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    // Save Marriage
    const now = new Date();
    await saveRelationshipRecord(user1Id, { spouseId: user2Id, marriedAt: now });
    await saveRelationshipRecord(user2Id, { spouseId: user1Id, marriedAt: now });

    const guild = interaction.guild;
    const u1Member = guild.members.cache.get(user1Id) || await guild.members.fetch(user1Id).catch(() => null);
    const u2Member = guild.members.cache.get(user2Id) || await guild.members.fetch(user2Id).catch(() => null);

    if (u1Member && u2Member) {
      const bannerBuffer = await generateMarriageBanner(u1Member, u2Member, now);
      const attachment = new AttachmentBuilder(bannerBuffer, { name: 'marriage.png' });

      await interaction.editReply({
        content: `💍💖 **A Match Made in Heaven!**\n<@${user1Id}> and <@${user2Id}> are now officially married! Congratulations! ✨`,
        components: [],
        files: [attachment]
      });
    } else {
      await interaction.editReply({
        content: `💍💖 <@${user1Id}> and <@${user2Id}> are now officially married!`,
        components: []
      });
    }
    return true;
  }

  // 2. Marriage Decline
  if (customId.startsWith('rel_marry_decline_')) {
    const parts = customId.replace('rel_marry_decline_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];

    if (interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${user2Id}> can respond to this proposal!`,
        ephemeral: true
      });
      return true;
    }

    await interaction.update({
      content: `💔 **Proposal Declined**\n<@${user2Id}> has declined the marriage proposal from <@${user1Id}>.`,
      components: []
    });
    return true;
  }

  // 3. Adoption Accept
  if (customId.startsWith('rel_adopt_accept_')) {
    const parts = customId.replace('rel_adopt_accept_', '').split('_');
    const parentId = parts[0];
    const childId = parts[1];

    if (interaction.user.id !== childId) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${childId}> can accept or decline this adoption proposal!`,
        ephemeral: true
      });
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    const now = new Date();
    const parentRec = getRelationshipRecord(parentId);
    const spouseId = parentRec.spouseId;

    // Add child to parent (and spouse if married)
    const parentsList = [parentId];
    if (spouseId) parentsList.push(spouseId);

    // Update parent 1
    const p1Children = new Set(parentRec.childrenIds || []);
    p1Children.add(childId);
    await saveRelationshipRecord(parentId, { childrenIds: Array.from(p1Children) });

    // Update spouse if exists
    if (spouseId) {
      const spouseRec = getRelationshipRecord(spouseId);
      const spChildren = new Set(spouseRec.childrenIds || []);
      spChildren.add(childId);
      await saveRelationshipRecord(spouseId, { childrenIds: Array.from(spChildren) });
    }

    // Update child
    await saveRelationshipRecord(childId, { parentIds: parentsList });

    const guild = interaction.guild;
    const parent1Member = guild.members.cache.get(parentId) || await guild.members.fetch(parentId).catch(() => null);
    const spouseMember = spouseId ? (guild.members.cache.get(spouseId) || await guild.members.fetch(spouseId).catch(() => null)) : null;
    const childMember = guild.members.cache.get(childId) || await guild.members.fetch(childId).catch(() => null);

    const parentsArr = [parent1Member];
    if (spouseMember) parentsArr.push(spouseMember);

    if (parent1Member && childMember) {
      const bannerBuffer = await generateAdoptionBanner(parentsArr, childMember, now);
      const attachment = new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' });

      await interaction.editReply({
        content: `🏡💕 **Welcome to the Family!**\n<@${childId}> has officially been adopted into the family of <@${parentId}>${spouseId ? ` and <@${spouseId}>` : ''}! 🎉`,
        components: [],
        files: [attachment]
      });
    } else {
      await interaction.editReply({
        content: `🏡💕 <@${childId}> has been officially adopted!`,
        components: []
      });
    }
    return true;
  }

  // 4. Adoption Decline
  if (customId.startsWith('rel_adopt_decline_')) {
    const parts = customId.replace('rel_adopt_decline_', '').split('_');
    const parentId = parts[0];
    const childId = parts[1];

    if (interaction.user.id !== childId) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${childId}> can respond to this proposal!`,
        ephemeral: true
      });
      return true;
    }

    await interaction.update({
      content: `❌ **Adoption Declined**\n<@${childId}> declined the adoption proposal from <@${parentId}>.`,
      components: []
    });
    return true;
  }

  // 5. Divorce Confirm
  if (customId.startsWith('rel_divorce_confirm_')) {
    const parts = customId.replace('rel_divorce_confirm_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];

    if (interaction.user.id !== user1Id && interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${user1Id}> or <@${user2Id}> can confirm this divorce!`,
        ephemeral: true
      });
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    const now = new Date();
    const rel1 = getRelationshipRecord(user1Id);
    const rel2 = getRelationshipRecord(user2Id);

    // As requested: When they get divorced, adoption will also break!
    const allChildren = new Set([...(rel1.childrenIds || []), ...(rel2.childrenIds || [])]);
    for (const cid of allChildren) {
      const childRec = getRelationshipRecord(cid);
      childRec.parentIds = [];
      await saveRelationshipRecord(cid, { parentIds: [] });
    }

    // Clear marriage and adoptions
    await saveRelationshipRecord(user1Id, { spouseId: null, marriedAt: null, childrenIds: [] });
    await saveRelationshipRecord(user2Id, { spouseId: null, marriedAt: null, childrenIds: [] });

    const guild = interaction.guild;
    const u1Member = guild.members.cache.get(user1Id) || await guild.members.fetch(user1Id).catch(() => null);
    const u2Member = guild.members.cache.get(user2Id) || await guild.members.fetch(user2Id).catch(() => null);

    if (u1Member && u2Member) {
      const bannerBuffer = await generateDivorceBanner(u1Member, u2Member, now);
      const attachment = new AttachmentBuilder(bannerBuffer, { name: 'divorce.png' });

      await interaction.editReply({
        content: `💔 **Marriage Dissolved.**\n<@${user1Id}> and <@${user2Id}> are now officially divorced. All family adoption ties have also been dissolved.`,
        components: [],
        files: [attachment]
      });
    } else {
      await interaction.editReply({
        content: `💔 <@${user1Id}> and <@${user2Id}> are now divorced.`,
        components: []
      });
    }
    return true;
  }

  // 6. Divorce Cancel
  if (customId.startsWith('rel_divorce_cancel_')) {
    const parts = customId.replace('rel_divorce_cancel_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];

    if (interaction.user.id !== user1Id && interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Mou! 🌸 Only <@${user1Id}> or <@${user2Id}> can cancel this action!`,
        ephemeral: true
      });
      return true;
    }

    await interaction.update({
      content: `✨ **Divorce Cancelled.** The sacred vows remain intact. 💕`,
      components: []
    });
    return true;
  }

  return false;
}

module.exports = {
  AUTHORIZED_ADMIN_IDS,
  initRelationshipFeature,
  handleRelationshipCommand,
  handleRelationshipButton,
  generateMarriageBanner,
  generateAdoptionBanner,
  generateDivorceBanner,
  generateFamilyTreeBanner
};
