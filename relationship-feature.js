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
 * Wipes all family and relationship records from memory and Firestore
 */
async function resetAllFamilies(db) {
  relationshipCache.clear();
  activeDivorceConfirmations.clear();
  activeAbandonConfirmations.clear();
  activePendingProposals.clear();

  const targetDb = db || dbRef;
  let deletedCount = 0;
  if (targetDb) {
    try {
      const snapshot = await targetDb.collection('relationships').get();
      if (!snapshot.empty) {
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = targetDb.batch();
          const chunk = docs.slice(i, i + 400);
          for (const doc of chunk) {
            batch.delete(doc.ref);
            deletedCount++;
          }
          await batch.commit();
        }
      }
      console.log(`[Relationship] Reset all families: deleted ${deletedCount} Firestore records.`);
    } catch (err) {
      console.error('[Relationship] Error resetting families in Firestore:', err.message);
    }
  }
  return deletedCount;
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
    // One-time reset requested by Master (runs only once, never on subsequent restarts)
    const resetMarkerRef = db.collection('server_settings').doc('family_reset_v1');
    const resetMarkerSnap = await resetMarkerRef.get().catch(() => null);
    if (!resetMarkerSnap || !resetMarkerSnap.exists) {
      await resetAllFamilies(db);
      await resetMarkerRef.set({ resetAt: new Date(), reason: 'Master requested full family reset' }).catch(() => {});
      console.log('[Relationship] One-time family_reset_v1 completed.');
      return;
    }

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
 * Returns otherId when otherId sits above userId in the family tree
 * (parent, grandparent, ...), else null. Walks both parent slots and
 * guards against an already-corrupted loop with the seen set.
 */
function findAncestorLink(userId, otherId) {
  if (!userId || !otherId) return null;

  const seen = new Set();
  const queue = [...(getRelationshipRecord(userId).parentIds || [])];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    if (id === otherId) return id;

    seen.add(id);
    queue.push(...(getRelationshipRecord(id).parentIds || []));
  }

  return null;
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
 * Helper: Safely fetches a guild member by ID (cache first, then API fetch)
 */
async function fetchGuildMemberSafe(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
}

/**
 * 4. Generates the Unified Connected Multi-Generation Family Tree Canvas Card
 *    - Climbs to the top-most Root Ancestor (checking both parentIds and spouse's parentIds)
 *    - Renders the entire connected family (grandparents, parents, aunts/uncles, siblings, spouses, children, nieces/nephews, grandchildren)
 *    - Prioritizes Spouse placement and deduplicates members so no one appears twice
 *    - Highlights the requested focusMember in the tree
 */
async function generateFamilyTreeBanner(focusMember, guild) {
  const focusId = focusMember.id;

  // 1. Climb to the Root Ancestor of the connected family
  function findRootAncestorId(startId) {
    let currId = startId;
    const visited = new Set();

    while (currId && !visited.has(currId)) {
      visited.add(currId);
      const rec = getRelationshipRecord(currId);
      if (rec.parentIds && rec.parentIds.length > 0) {
        currId = rec.parentIds[0];
        continue;
      }
      // If current user has no parents, check if their spouse has parents (connects in-laws like coo -> Enzesty -> Zoey's Wife)
      if (rec.spouseId && !visited.has(rec.spouseId)) {
        const spRec = getRelationshipRecord(rec.spouseId);
        if (spRec.parentIds && spRec.parentIds.length > 0) {
          currId = spRec.parentIds[0];
          continue;
        }
      }
      break;
    }
    return currId;
  }

  const rootId = findRootAncestorId(focusId);

  // 2. Build recursive tree top-down with Spouse Priority & Deduplication
  const placedIds = new Set();
  const MAX_DEPTH = 6;

  async function buildTreeNode(memberId, depth) {
    if (!memberId || placedIds.has(memberId) || depth > MAX_DEPTH) return null;

    const member = await fetchGuildMemberSafe(guild, memberId);
    if (!member) return null;

    placedIds.add(memberId);

    const rec = getRelationshipRecord(memberId);
    let spouseMember = null;
    let spouseRec = null;

    if (rec.spouseId && !placedIds.has(rec.spouseId)) {
      const sp = await fetchGuildMemberSafe(guild, rec.spouseId);
      if (sp) {
        spouseMember = sp;
        spouseRec = getRelationshipRecord(rec.spouseId);
        placedIds.add(rec.spouseId);
      }
    }

    // Merge children of both spouses (deduplicated)
    const rawChildIds = new Set([
      ...(rec.childrenIds || []),
      ...(spouseRec?.childrenIds || [])
    ]);

    const children = [];
    for (const cid of rawChildIds) {
      if (placedIds.has(cid)) continue;
      // Spouse priority: if this child is married to someone already placed higher up, skip duplicate
      const cRec = getRelationshipRecord(cid);
      if (cRec.spouseId && placedIds.has(cRec.spouseId)) {
        continue;
      }
      const childNode = await buildTreeNode(cid, depth + 1);
      if (childNode) children.push(childNode);
    }

    return {
      id: memberId,
      member,
      spouse: spouseMember,
      depth,
      children
    };
  }

  const rootNode = await buildTreeNode(rootId, 0);

  // Fallback if root somehow failed to load
  const treeRoot = rootNode || {
    id: focusId,
    member: focusMember,
    spouse: null,
    depth: 0,
    children: []
  };

  // 3. Measure Subtree Widths & Max Depth
  const cardW = 205;
  const cardH = 84;
  const coupleGap = 48; // space for heart between spouses
  const hGap = 24;
  const vGap = 54;

  let maxDepth = 0;

  function measureSubtree(node) {
    if (node.depth > maxDepth) maxDepth = node.depth;
    node.unitW = node.spouse ? (cardW * 2 + coupleGap) : cardW;

    if (node.children.length === 0) {
      node.subtreeW = node.unitW;
    } else {
      let childrenTotalW = 0;
      for (let i = 0; i < node.children.length; i++) {
        measureSubtree(node.children[i]);
        childrenTotalW += node.children[i].subtreeW;
        if (i < node.children.length - 1) childrenTotalW += hGap;
      }
      node.subtreeW = Math.max(node.unitW, childrenTotalW);
    }
  }

  measureSubtree(treeRoot);

  // 4. Compute Dynamic Canvas Dimensions
  const hasAnyChildren = treeRoot.children.length > 0;
  const width = Math.max(1200, treeRoot.subtreeW + 100);
  const topStartY = 85;
  const depthRows = hasAnyChildren ? (maxDepth + 1) : 2;
  const neededH = topStartY + depthRows * cardH + Math.max(1, depthRows - 1) * vGap + 55;
  const height = Math.max(675, neededH);

  // 5. Assign X/Y Positions Recursively
  function assignPositions(node, leftX, topY) {
    node.centerX = leftX + node.subtreeW / 2;
    node.unitX = node.centerX - node.unitW / 2;
    node.y = topY;

    if (node.children.length > 0) {
      let childrenTotalW = 0;
      for (let i = 0; i < node.children.length; i++) {
        childrenTotalW += node.children[i].subtreeW;
        if (i < node.children.length - 1) childrenTotalW += hGap;
      }
      let childLeftX = node.centerX - childrenTotalW / 2;
      const childTopY = topY + cardH + vGap;

      for (const child of node.children) {
        assignPositions(child, childLeftX, childTopY);
        childLeftX += child.subtreeW + hGap;
      }
    }
  }

  assignPositions(treeRoot, (width - treeRoot.subtreeW) / 2, topStartY);

  // 6. Setup Canvas & Draw Background
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgImg = await getAssetImage('family_tree');
  if (bgImg) {
    const scale = Math.max(width / bgImg.width, height / bgImg.height);
    const drawW = bgImg.width * scale;
    const drawH = bgImg.height * scale;
    ctx.drawImage(bgImg, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  } else {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#030712');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Dark overlay
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const focusDisp = focusMember.displayName || focusMember.user?.username || 'User';
  const familyTitle = `${focusDisp}'s Family Tree`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'italic 900 32px "Segoe UI", Montserrat, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = 16;
  ctx.fillText(fitText(ctx, familyTitle, width - 120), width / 2, 22);
  ctx.restore();

  const tierColors = [
    { stroke: '#a855f7', glow: '#c084fc', label: 'ROOT' },
    { stroke: '#38bdf8', glow: '#7dd3fc', label: 'GEN 2' },
    { stroke: '#84cc16', glow: '#a3e635', label: 'GEN 3' },
    { stroke: '#f59e0b', glow: '#fbbf24', label: 'GEN 4' },
    { stroke: '#14b8a6', glow: '#2dd4bf', label: 'GEN 5' },
    { stroke: '#f472b6', glow: '#f9a8d4', label: 'GEN 6' }
  ];

  const heartImg = await getAssetImage('heart');

  // 7. Draw Nodes & Connecting Lines Recursively
  async function renderNode(node) {
    const palette = tierColors[Math.min(node.depth, tierColors.length - 1)];

    // Draw lines to children first
    if (node.children.length > 0) {
      const stemStartY = node.y + cardH;
      const barY = stemStartY + Math.round(vGap * 0.48);
      const childTopY = node.children[0].y;

      ctx.save();
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = palette.glow;
      ctx.shadowBlur = 12;

      ctx.beginPath();
      ctx.moveTo(node.centerX, stemStartY);
      ctx.lineTo(node.centerX, barY);
      ctx.stroke();

      if (node.children.length === 1) {
        ctx.beginPath();
        ctx.moveTo(node.centerX, barY);
        ctx.lineTo(node.children[0].centerX, barY);
        ctx.lineTo(node.children[0].centerX, childTopY);
        ctx.stroke();
      } else {
        const firstCX = node.children[0].centerX;
        const lastCX = node.children[node.children.length - 1].centerX;
        ctx.beginPath();
        ctx.moveTo(Math.min(firstCX, node.centerX), barY);
        ctx.lineTo(Math.max(lastCX, node.centerX), barY);
        ctx.stroke();

        for (const child of node.children) {
          ctx.beginPath();
          ctx.moveTo(child.centerX, barY);
          ctx.lineTo(child.centerX, childTopY);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Draw member card (and spouse card if married)
    const isMainFocus = node.member.id === focusId;
    const isSpouseFocus = node.spouse && node.spouse.id === focusId;

    if (node.spouse) {
      const m1Stroke = isMainFocus ? '#38bdf8' : '#ec4899';
      const m1Glow = isMainFocus ? '#7dd3fc' : '#f472b6';
      const m1Badge = isMainFocus ? '★ YOU • SPOUSE' : (node.depth === 0 ? 'HEAD • SPOUSE 1' : 'SPOUSE 1');

      const m2Stroke = isSpouseFocus ? '#38bdf8' : '#ec4899';
      const m2Glow = isSpouseFocus ? '#7dd3fc' : '#f472b6';
      const m2Badge = isSpouseFocus ? '★ YOU • SPOUSE' : 'SPOUSE 2';

      await drawFamilyNodeCard(ctx, node.member, node.unitX, node.y, cardW, cardH, m1Badge, m1Stroke, m1Glow);
      await drawFamilyNodeCard(ctx, node.spouse, node.unitX + cardW + coupleGap, node.y, cardW, cardH, m2Badge, m2Stroke, m2Glow);

      if (heartImg) {
        ctx.save();
        ctx.shadowColor = '#ec4899';
        ctx.shadowBlur = 14;
        ctx.drawImage(heartImg, node.centerX - 16, node.y + cardH / 2 - 16, 32, 32);
        ctx.restore();
      }
    } else {
      const mStroke = isMainFocus ? '#38bdf8' : palette.stroke;
      const mGlow = isMainFocus ? '#7dd3fc' : palette.glow;
      const mBadge = isMainFocus ? '★ YOU' : (node.depth === 0 ? 'HEAD OF FAMILY' : palette.label);
      await drawFamilyNodeCard(ctx, node.member, node.unitX, node.y, cardW, cardH, mBadge, mStroke, mGlow);
    }

    // Render children recursively
    for (const child of node.children) {
      await renderNode(child);
    }
  }

  await renderNode(treeRoot);

  // If root has no children at all, show clean empty state below
  if (!hasAnyChildren) {
    const branchDropY = treeRoot.y + cardH + Math.round(vGap * 0.48);
    const emptyY = treeRoot.y + cardH + vGap + 10;

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(treeRoot.centerX, treeRoot.y + cardH);
    ctx.lineTo(treeRoot.centerX, branchDropY);
    ctx.lineTo(treeRoot.centerX, emptyY);
    ctx.stroke();

    const emptyW = 340;
    const emptyH = 68;
    const emptyX = (width - emptyW) / 2;

    drawRoundRect(ctx, emptyX, emptyY, emptyW, emptyH, 14);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
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

// Active mutual divorce confirmations: key: `${min(u1, u2)}_${max(u1, u2)}` -> Set(confirmedUserIds)
const activeDivorceConfirmations = new Map();

// Active mutual abandon confirmations: key: `${min(p1, p2)}_${max(p1, p2)}_${childId}` -> Set(confirmedParentIds)
const activeAbandonConfirmations = new Map();

// Proposal anti-spam limits
const PROPOSAL_EXPIRY_MS = 5 * 60 * 1000;       // 5 minutes expiry
const REJECTION_COOLDOWN_MS = 15 * 60 * 1000;   // 15 minutes rejection cooldown
const COMMAND_COOLDOWN_MS = 30 * 1000;          // 30 seconds command rate limit

// Tracks active pending proposals: key: `${senderId}_${type}` -> { targetId, createdAt }
const activePendingProposals = new Map();

// Tracks rejection cooldowns: key: `${rejectedSenderId}_${rejecterId}_${type}` -> expiresAt
const rejectionCooldowns = new Map();

// Tracks user command rate limits: key: `${userId}_${cmd}` -> lastUsed timestamp
const relCommandCooldowns = new Map();

/**
 * Universal safe Container sender with fallback
 */
async function sendRelContainer(target, payload, sendContainer) {
  if (typeof sendContainer === 'function') {
    return await sendContainer(target, payload);
  }
  if (target.reply && typeof target.reply === 'function') {
    if (target.deferred && !target.replied) return await target.editReply(payload);
    if (target.replied) return await target.followUp(payload);
    return await target.reply(payload);
  }
  if (target.send && typeof target.send === 'function') {
    return await target.send(payload);
  }
}

/**
 * Sends a direct message safely, ignoring blocked DMs
 */
async function sendSafeDM(target, payload, sendContainer) {
  if (!target) return;
  const user = target.user || target;
  try {
    if (typeof sendContainer === 'function') {
      await sendContainer(user, payload);
    } else if (user.send) {
      await user.send(payload);
    }
  } catch (e) {
    // DM disabled or blocked
  }
}

/**
 * Safely resolves the active Discord guild even when an interaction originates in DMs
 */
function getSafeGuild(client, interaction = null) {
  if (interaction?.guild) return interaction.guild;
  return client.guilds.cache.get('1517882821673357312') ||
         client.guilds.cache.get('1555205544984449034') ||
         client.guilds.cache.first() || null;
}

/**
 * Safely fetches a GuildMember or User object even in DMs
 */
async function getSafeMemberOrUser(client, guild, userId) {
  if (!userId) return null;
  if (guild) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member) return member;
  }
  return client.users.cache.get(userId) || await client.users.fetch(userId).catch(() => null);
}

/**
 * Handles text commands: <marry, <adopt, <divorce, <abandon, <leave, <familytree, <family
 */
async function handleRelationshipCommand(message, client, db, sendContainer = null) {
  const content = (message.content || '').trim();

  // Check prefix: '<' or '-'
  if (!content.startsWith('<') && !content.startsWith('-')) return false;

  const rawCmd = content.slice(1).trim();
  const cmd = (rawCmd.split(/\s+/)[0] || '').toLowerCase();

  const relationshipCommands = new Set(['marry', 'adopt', 'divorce', 'abandon', 'leave', 'familytree', 'family', 'resetfamilies', 'familyreset']);
  if (!relationshipCommands.has(cmd)) return false;

  // Master-only: <resetfamilies / <familyreset
  if (cmd === 'resetfamilies' || cmd === 'familyreset') {
    if (message.author.id !== '1013822181379162142') {
      await sendRelContainer(message, {
        description: 'Mou! 🔒 This command is restricted solely to Master <@1013822181379162142>.',
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
      return true;
    }
    const deletedCount = await resetAllFamilies(db);
    await sendRelContainer(message, {
      description: `All server families, marriages, and adoptions have been reset. (\`${deletedCount}\` database records cleared)`,
      footer: 'AniPedia Sanctuary',
      timestamp: Date.now()
    }, sendContainer);
    return true;
  }

  // 1. <marry [@user]
  if (cmd === 'marry') {
    await handleMarryCommand(message, client, sendContainer);
    return true;
  }

  // 2. <adopt [@user]
  if (cmd === 'adopt') {
    await handleAdoptCommand(message, client, sendContainer);
    return true;
  }

  // 3. <divorce [@user]
  if (cmd === 'divorce') {
    await handleDivorceCommand(message, client, sendContainer);
    return true;
  }

  // 4. <abandon [@child]
  if (cmd === 'abandon') {
    await handleAbandonCommand(message, client, sendContainer);
    return true;
  }

  // 5. <leave
  if (cmd === 'leave') {
    await handleLeaveCommand(message, client, sendContainer);
    return true;
  }

  // 6. <familytree / <family [@user]
  if (cmd === 'familytree' || cmd === 'family') {
    await handleFamilyTreeCommand(message, client, sendContainer);
    return true;
  }

  return false;
}

/**
 * <marry handler
 */
async function handleMarryCommand(message, client, sendContainer = null) {
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
    await sendRelContainer(message, {
      description: 'Please mention a valid user to marry. Example: <marry @user>',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (user1Member.id === user2Member.id) {
    await sendRelContainer(message, {
      description: 'You cannot marry yourself.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (user2Member.user?.bot) {
    await sendRelContainer(message, {
      description: 'You cannot marry a bot.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  const rel1 = getRelationshipRecord(user1Member.id);
  const rel2 = getRelationshipRecord(user2Member.id);

  if (rel1.spouseId) {
    await sendRelContainer(message, {
      description: `<@${user1Member.id}> is already married to <@${rel1.spouseId}>. You must divorce first before marrying someone else.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (rel2.spouseId) {
    await sendRelContainer(message, {
      description: `<@${user2Member.id}> is already married to <@${rel2.spouseId}>.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // Check parent-child conflict
  if (rel1.childrenIds.includes(user2Member.id) || rel2.childrenIds.includes(user1Member.id)) {
    await sendRelContainer(message, {
      description: 'A parent cannot marry their adopted child.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // Anti-spam & Cooldown Checks
  const now = Date.now();
  const lastMarryCmd = relCommandCooldowns.get(`${user1Member.id}_marry`) || 0;
  if (now - lastMarryCmd < COMMAND_COOLDOWN_MS) {
    const waitSecs = Math.ceil((COMMAND_COOLDOWN_MS - (now - lastMarryCmd)) / 1000);
    await sendRelContainer(message, {
      description: `Please wait ${waitSecs} second${waitSecs > 1 ? 's' : ''} before using marry again.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // Check 15-minute rejection cooldown (blocked only if user2Member rejected user1Member)
  const rejectionKey = `${user1Member.id}_${user2Member.id}_marry`;
  const rejectionExpiry = rejectionCooldowns.get(rejectionKey);
  if (rejectionExpiry && rejectionExpiry > now) {
    const waitMins = Math.ceil((rejectionExpiry - now) / 60000);
    await sendRelContainer(message, {
      description: `You were recently declined by <@${user2Member.id}>. Please wait ${waitMins} minute${waitMins > 1 ? 's' : ''} before proposing to them again.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // If user1Member was the one who rejected user2Member in the past, proposing now clears any previous block
  rejectionCooldowns.delete(`${user2Member.id}_${user1Member.id}_marry`);

  // Check active pending proposal limit (max 1 active proposal, 5m expiry)
  const pendingProposal = activePendingProposals.get(`${user1Member.id}_marry`);
  if (pendingProposal) {
    if (now - pendingProposal.createdAt < PROPOSAL_EXPIRY_MS) {
      const waitMins = Math.ceil((PROPOSAL_EXPIRY_MS - (now - pendingProposal.createdAt)) / 60000);
      await sendRelContainer(message, {
        description: `You already have an active marriage proposal to <@${pendingProposal.targetId}>. Please wait for their response or for the proposal to expire (${waitMins}m).`,
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
      return;
    } else {
      activePendingProposals.delete(`${user1Member.id}_marry`);
    }
  }

  // Record rate limit and active pending proposal
  relCommandCooldowns.set(`${user1Member.id}_marry`, now);
  activePendingProposals.set(`${user1Member.id}_marry`, {
    targetId: user2Member.id,
    createdAt: now
  });

  // Build Interactive Proposal Row (No emojis, no bold)
  const channelId = message.channel?.id || '';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_marry_accept_${user1Member.id}_${user2Member.id}_${channelId}_${now}`)
      .setLabel('Accept (Yes)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rel_marry_decline_${user1Member.id}_${user2Member.id}_${channelId}_${now}`)
      .setLabel('Decline (No)')
      .setStyle(ButtonStyle.Danger)
  );

  const proposalDesc = `<@${user2Member.id}>, do you accept the marriage proposal from <@${user1Member.id}>?`;

  await sendRelContainer(message, {
    description: proposalDesc,
    footer: 'AniPedia Sanctuary',
    components: [row]
  }, sendContainer);

  // Send DM to target user with proposal
  await sendSafeDM(user2Member, {
    description: `You received a marriage proposal from <@${user1Member.id}> in ${message.guild.name}. Do you accept?`,
    footer: 'AniPedia Sanctuary',
    components: [row]
  }, sendContainer);
}

/**
 * <adopt handler
 */
async function handleAdoptCommand(message, client, sendContainer = null) {
  const targetMember = message.mentions.members.filter(m => m.id !== client.user.id && m.id !== message.author.id).first();

  if (!targetMember) {
    await sendRelContainer(message, {
      description: 'Please mention a user to adopt. Example: <adopt @user>',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (targetMember.id === message.author.id) {
    await sendRelContainer(message, {
      description: 'You cannot adopt yourself.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (targetMember.user?.bot) {
    await sendRelContainer(message, {
      description: 'You cannot adopt a bot.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  const parentRel = getRelationshipRecord(message.author.id);
  const childRel = getRelationshipRecord(targetMember.id);

  if (parentRel.spouseId === targetMember.id) {
    await sendRelContainer(message, {
      description: 'You cannot adopt your own spouse.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (childRel.parentIds && childRel.parentIds.length > 0) {
    await sendRelContainer(message, {
      description: `<@${targetMember.id}> is already adopted in a family. They must leave their family first.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (parentRel.childrenIds.includes(targetMember.id)) {
    await sendRelContainer(message, {
      description: `<@${targetMember.id}> is already your adopted child.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // A descendant cannot adopt an ancestor, and an ancestor cannot adopt a
  // descendant: either way the family tree would end up in a loop.
  if (findAncestorLink(message.author.id, targetMember.id)) {
    await sendRelContainer(message, {
      description: `It's not possible. <@${targetMember.id}> is your ancestor.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  if (findAncestorLink(targetMember.id, message.author.id)) {
    await sendRelContainer(message, {
      description: `It's not possible. <@${targetMember.id}> is your descendant.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // Anti-spam & Cooldown Checks
  const now = Date.now();
  const lastAdoptCmd = relCommandCooldowns.get(`${message.author.id}_adopt`) || 0;
  if (now - lastAdoptCmd < COMMAND_COOLDOWN_MS) {
    const waitSecs = Math.ceil((COMMAND_COOLDOWN_MS - (now - lastAdoptCmd)) / 1000);
    await sendRelContainer(message, {
      description: `Please wait ${waitSecs} second${waitSecs > 1 ? 's' : ''} before using adopt again.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // Check 15-minute rejection cooldown (blocked only if targetMember rejected message.author)
  const rejectionKey = `${message.author.id}_${targetMember.id}_adopt`;
  const rejectionExpiry = rejectionCooldowns.get(rejectionKey);
  if (rejectionExpiry && rejectionExpiry > now) {
    const waitMins = Math.ceil((rejectionExpiry - now) / 60000);
    await sendRelContainer(message, {
      description: `You were recently declined by <@${targetMember.id}>. Please wait ${waitMins} minute${waitMins > 1 ? 's' : ''} before proposing to them again.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  // If message.author was the one who rejected targetMember in the past, proposing now clears any previous block
  rejectionCooldowns.delete(`${targetMember.id}_${message.author.id}_adopt`);

  // Check active pending proposal limit for this target (5m expiry)
  const adoptProposalKey = `${message.author.id}_${targetMember.id}_adopt`;
  const pendingProposal = activePendingProposals.get(adoptProposalKey);
  if (pendingProposal) {
    if (now - pendingProposal.createdAt < PROPOSAL_EXPIRY_MS) {
      const waitMins = Math.ceil((PROPOSAL_EXPIRY_MS - (now - pendingProposal.createdAt)) / 60000);
      await sendRelContainer(message, {
        description: `You already have an active adoption proposal to <@${pendingProposal.targetId}>. Please wait for their response or for the proposal to expire (${waitMins}m).`,
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
      return;
    } else {
      activePendingProposals.delete(adoptProposalKey);
    }
  }

  // Record rate limit and active pending proposal
  relCommandCooldowns.set(`${message.author.id}_adopt`, now);
  activePendingProposals.set(adoptProposalKey, {
    targetId: targetMember.id,
    createdAt: now
  });

  // Build Interactive Proposal Row (No emojis, no bold)
  const channelId = message.channel?.id || '';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_adopt_accept_${message.author.id}_${targetMember.id}_${channelId}_${now}`)
      .setLabel('Accept (Yes)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`rel_adopt_decline_${message.author.id}_${targetMember.id}_${channelId}_${now}`)
      .setLabel('Decline (No)')
      .setStyle(ButtonStyle.Danger)
  );

  const proposalDesc = `<@${targetMember.id}>, do you accept the proposal to be adopted into the family of <@${message.author.id}>?`;

  await sendRelContainer(message, {
    description: proposalDesc,
    footer: 'AniPedia Sanctuary',
    components: [row]
  }, sendContainer);

  // Send DM to target user with proposal
  await sendSafeDM(targetMember, {
    description: `You received an adoption proposal to join the family of <@${message.author.id}> in ${message.guild.name}. Do you accept?`,
    footer: 'AniPedia Sanctuary',
    components: [row]
  }, sendContainer);
}

/**
 * <divorce handler (requires mutual confirmation from both partners)
 */
async function handleDivorceCommand(message, client, sendContainer = null) {
  const rel = getRelationshipRecord(message.author.id);
  if (!rel.spouseId) {
    await sendRelContainer(message, {
      description: 'You are not married to anyone.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  const user1Id = message.author.id;
  const user2Id = rel.spouseId;

  const key = [user1Id, user2Id].sort().join('_');
  activeDivorceConfirmations.set(key, new Set());

  // Interactive Confirmation Row (No emojis, no bold)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rel_divorce_confirm_${user1Id}_${user2Id}`)
      .setLabel('Confirm (Yes)')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`rel_divorce_cancel_${user1Id}_${user2Id}`)
      .setLabel('Cancel (No)')
      .setStyle(ButtonStyle.Secondary)
  );

  const desc = `Divorce confirmation requested between <@${user1Id}> and <@${user2Id}>.\nBoth partners must confirm to proceed. Dissolving this marriage will also dissolve all associated family adoptions.\n\nStatus:\n<@${user1Id}>: Pending\n<@${user2Id}>: Pending`;

  await sendRelContainer(message, {
    description: desc,
    footer: 'AniPedia Sanctuary',
    components: [row]
  }, sendContainer);

  const spouseMember = message.guild.members.cache.get(user2Id) || await message.guild.members.fetch(user2Id).catch(() => null);
  if (spouseMember) {
    await sendSafeDM(spouseMember, {
      description: `A divorce confirmation was requested by <@${user1Id}> in ${message.guild.name}. Both partners must confirm in the server.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
  }
}

/**
 * <abandon handler (Parents remove an adopted child; if two parents, both must confirm)
 */
async function handleAbandonCommand(message, client, sendContainer = null) {
  let targetMember = message.mentions.members.filter(m => m.id !== client.user.id && m.id !== message.author.id).first();

  if (!targetMember) {
    const args = message.content.trim().split(/\s+/).slice(1);
    if (args[0]) {
      const cleanId = args[0].replace(/[<@!>]/g, '');
      targetMember = message.guild.members.cache.get(cleanId) || await message.guild.members.fetch(cleanId).catch(() => null);
    }
  }

  if (!targetMember) {
    await sendRelContainer(message, {
      description: 'Please mention an adopted child to abandon. Example: <abandon @child>',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  const parentRec = getRelationshipRecord(message.author.id);
  if (!parentRec.childrenIds || !parentRec.childrenIds.includes(targetMember.id)) {
    await sendRelContainer(message, {
      description: `<@${targetMember.id}> is not your adopted child.`,
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
    return;
  }

  const spouseId = parentRec.spouseId;
  const isTwoParents = Boolean(spouseId);

  if (isTwoParents) {
    // Two parents: both must confirm in the same message
    const key = `${[message.author.id, spouseId].sort().join('_')}_${targetMember.id}`;
    activeAbandonConfirmations.set(key, new Set());

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rel_abandon_confirm_${message.author.id}_${spouseId}_${targetMember.id}`)
        .setLabel('Confirm (Yes)')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`rel_abandon_cancel_${message.author.id}_${spouseId}_${targetMember.id}`)
        .setLabel('Cancel (No)')
        .setStyle(ButtonStyle.Secondary)
    );

    const desc = `Abandon confirmation requested for <@${targetMember.id}>.\nBoth parents (<@${message.author.id}> and <@${spouseId}>) must confirm to remove the child from the family.\n\nStatus:\n<@${message.author.id}>: Pending\n<@${spouseId}>: Pending`;

    await sendRelContainer(message, {
      description: desc,
      footer: 'AniPedia Sanctuary',
      components: [row]
    }, sendContainer);

    const spouseMember = message.guild.members.cache.get(spouseId) || await message.guild.members.fetch(spouseId).catch(() => null);
    if (spouseMember) {
      await sendSafeDM(spouseMember, {
        description: `An abandon request for <@${targetMember.id}> was initiated by <@${message.author.id}> in ${message.guild.name}. Both parents must confirm in the server.`,
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
    }
  } else {
    // Single parent: direct confirmation
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rel_abandon_confirm_${message.author.id}_none_${targetMember.id}`)
        .setLabel('Confirm (Yes)')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`rel_abandon_cancel_${message.author.id}_none_${targetMember.id}`)
        .setLabel('Cancel (No)')
        .setStyle(ButtonStyle.Secondary)
    );

    await sendRelContainer(message, {
      description: `Do you want to abandon and remove <@${targetMember.id}> from your family?`,
      footer: 'AniPedia Sanctuary',
      components: [row]
    }, sendContainer);
  }
}

/**
 * <leave handler
 */
async function handleLeaveCommand(message, client, sendContainer = null) {
  const rel = getRelationshipRecord(message.author.id);

  if (!rel.parentIds || rel.parentIds.length === 0) {
    await sendRelContainer(message, {
      description: 'You are not currently adopted by any family.',
      footer: 'AniPedia Sanctuary'
    }, sendContainer);
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

  await sendRelContainer(message, {
    description: `<@${message.author.id}> has left their adopted family and is now independent.`,
    footer: 'AniPedia Sanctuary',
    timestamp: Date.now()
  }, sendContainer);

  // Notify former parents via DM
  for (const pid of formerParents) {
    const pMember = message.guild.members.cache.get(pid) || await message.guild.members.fetch(pid).catch(() => null);
    if (pMember) {
      await sendSafeDM(pMember, {
        description: `<@${message.author.id}> has left your family in ${message.guild.name}.`,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now()
      }, sendContainer);
    }
  }
}

/**
 * <familytree / <family handler
 */
async function handleFamilyTreeCommand(message, client, sendContainer = null) {
  await message.channel.sendTyping().catch(() => {});

  let targetMember = message.mentions.members.filter(m => m.id !== client.user.id).first() || message.member;

  const cardBuffer = await generateFamilyTreeBanner(targetMember, message.guild);
  const attachment = new AttachmentBuilder(cardBuffer, { name: 'family_tree.png' });

  await sendRelContainer(message, {
    image: 'attachment://family_tree.png',
    footer: 'AniPedia Family Registry',
    timestamp: Date.now(),
    files: [attachment]
  }, sendContainer);
}

/**
 * Handles button interactions for Relationship features
 */
async function handleRelationshipButton(interaction, client, db, sendContainer = null) {
  const customId = interaction.customId;
  if (!customId.startsWith('rel_')) return false;

  const isGuildInteraction = Boolean(interaction.guildId);

  // 1. Marriage Accept
  if (customId.startsWith('rel_marry_accept_')) {
    const parts = customId.replace('rel_marry_accept_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];
    const originChannelId = parts[2] || null;
    const createdAt = parseInt(parts[3]) || 0;

    if (interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Only <@${user2Id}> can accept or decline this proposal.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    // Check 5-minute proposal expiration
    if (createdAt && (Date.now() - createdAt > PROPOSAL_EXPIRY_MS)) {
      await interaction.deferUpdate().catch(() => {});
      activePendingProposals.delete(`${user1Id}_marry`);
      await sendRelContainer(interaction, {
        description: 'This marriage proposal has expired. Please send a new proposal.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    // The pair may have changed since the proposal was sent: never marry
    // someone who is already married now.
    if (getRelationshipRecord(user1Id).spouseId || getRelationshipRecord(user2Id).spouseId) {
      await sendRelContainer(interaction, {
        description: 'This proposal can no longer be completed - one of you is already married now.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    // Clear pending proposal and rejection cooldowns between these two
    activePendingProposals.delete(`${user1Id}_marry`);
    rejectionCooldowns.delete(`${user1Id}_${user2Id}_marry`);
    rejectionCooldowns.delete(`${user2Id}_${user1Id}_marry`);

    // Save Marriage
    const now = new Date();
    await saveRelationshipRecord(user1Id, { spouseId: user2Id, marriedAt: now });
    await saveRelationshipRecord(user2Id, { spouseId: user1Id, marriedAt: now });

    const guild = getSafeGuild(client, interaction);
    const guildName = guild?.name || 'AniPedia';

    const u1Member = await getSafeMemberOrUser(client, guild, user1Id);
    const u2Member = await getSafeMemberOrUser(client, guild, user2Id);

    let bannerBuffer = null;
    if (u1Member && u2Member) {
      bannerBuffer = await generateMarriageBanner(u1Member, u2Member, now).catch(err => {
        console.error('[Relationship] Marriage banner error:', err);
        return null;
      });
    }

    const files = bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'marriage.png' })] : [];
    const completedDesc = `<@${user1Id}> and <@${user2Id}> are now officially married.`;

    // Update the message where the button was clicked
    await sendRelContainer(interaction, {
      description: completedDesc,
      image: bannerBuffer ? 'attachment://marriage.png' : undefined,
      footer: 'AniPedia Sanctuary',
      timestamp: Date.now(),
      files,
      components: []
    }, sendContainer);

    // If accepted in DM and origin channel is known, also post the announcement in the server channel
    if (!interaction.guildId && originChannelId) {
      const originChannel = client.channels.cache.get(originChannelId) || await client.channels.fetch(originChannelId).catch(() => null);
      if (originChannel && originChannel.send) {
        await sendRelContainer(originChannel, {
          description: completedDesc,
          image: bannerBuffer ? 'attachment://marriage.png' : undefined,
          footer: 'AniPedia Sanctuary',
          timestamp: Date.now(),
          files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'marriage.png' })] : []
        }, sendContainer).catch(() => {});
      }
    }

    // Send DM notifications
    if (u1Member && interaction.user.id !== user1Id) {
      await sendSafeDM(u1Member, {
        description: `You and <@${user2Id}> are now officially married in ${guildName}.`,
        image: bannerBuffer ? 'attachment://marriage.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'marriage.png' })] : []
      }, sendContainer);
    }

    if (u2Member && interaction.user.id !== user2Id) {
      await sendSafeDM(u2Member, {
        description: `You and <@${user1Id}> are now officially married in ${guildName}.`,
        image: bannerBuffer ? 'attachment://marriage.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'marriage.png' })] : []
      }, sendContainer);
    }

    return true;
  }

  // 2. Marriage Decline
  if (customId.startsWith('rel_marry_decline_')) {
    const parts = customId.replace('rel_marry_decline_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];
    const originChannelId = parts[2] || null;
    const createdAt = parseInt(parts[3]) || 0;

    if (interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Only <@${user2Id}> can respond to this proposal.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    // Check 5-minute proposal expiration
    if (createdAt && (Date.now() - createdAt > PROPOSAL_EXPIRY_MS)) {
      await interaction.deferUpdate().catch(() => {});
      activePendingProposals.delete(`${user1Id}_marry`);
      await sendRelContainer(interaction, {
        description: 'This marriage proposal has expired.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    // Free pending proposal slot & set 15-minute rejection cooldown for user1 proposing to user2
    activePendingProposals.delete(`${user1Id}_marry`);
    rejectionCooldowns.set(`${user1Id}_${user2Id}_marry`, Date.now() + REJECTION_COOLDOWN_MS);

    await sendRelContainer(interaction, {
      description: `<@${user2Id}> declined the marriage proposal from <@${user1Id}>.`,
      footer: 'AniPedia Sanctuary',
      components: []
    }, sendContainer);

    if (!interaction.guildId && originChannelId) {
      const originChannel = client.channels.cache.get(originChannelId) || await client.channels.fetch(originChannelId).catch(() => null);
      if (originChannel && originChannel.send) {
        await sendRelContainer(originChannel, {
          description: `<@${user2Id}> declined the marriage proposal from <@${user1Id}>.`,
          footer: 'AniPedia Sanctuary',
          components: []
        }, sendContainer).catch(() => {});
      }
    }

    const u1 = client.users.cache.get(user1Id) || await client.users.fetch(user1Id).catch(() => null);
    if (u1) {
      await sendSafeDM(u1, {
        description: `<@${user2Id}> declined your marriage proposal.`,
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
    }
    return true;
  }

  // 3. Adoption Accept
  if (customId.startsWith('rel_adopt_accept_')) {
    const parts = customId.replace('rel_adopt_accept_', '').split('_');
    const parentId = parts[0];
    const childId = parts[1];
    const originChannelId = parts[2] || null;
    const createdAt = parseInt(parts[3]) || 0;

    if (interaction.user.id !== childId) {
      await interaction.reply({
        content: `Only <@${childId}> can accept or decline this adoption proposal.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    // Check 5-minute proposal expiration
    if (createdAt && (Date.now() - createdAt > PROPOSAL_EXPIRY_MS)) {
      await interaction.deferUpdate().catch(() => {});
      activePendingProposals.delete(`${parentId}_${childId}_adopt`);
      await sendRelContainer(interaction, {
        description: 'This adoption proposal has expired. Please send a new proposal.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    // The child may have been adopted elsewhere since the proposal was sent.
    if ((getRelationshipRecord(childId).parentIds || []).length > 0) {
      await sendRelContainer(interaction, {
        description: `It's not possible. <@${childId}> has already joined another family since this proposal was sent.`,
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    // Re-check on accept: if the tree changed while the proposal sat there,
    // accepting it must not be able to close a loop.
    if (findAncestorLink(parentId, childId)) {
      await sendRelContainer(interaction, {
        description: `It's not possible. <@${childId}> is <@${parentId}>'s ancestor, so this adoption cannot be completed.`,
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    if (findAncestorLink(childId, parentId)) {
      await sendRelContainer(interaction, {
        description: `It's not possible. <@${childId}> is <@${parentId}>'s descendant, so this adoption cannot be completed.`,
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    // Clear pending proposal and rejection cooldowns between these two
    activePendingProposals.delete(`${parentId}_${childId}_adopt`);
    rejectionCooldowns.delete(`${parentId}_${childId}_adopt`);
    rejectionCooldowns.delete(`${childId}_${parentId}_adopt`);

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

    const guild = getSafeGuild(client, interaction);
    const guildName = guild?.name || 'AniPedia';

    const parent1Member = await getSafeMemberOrUser(client, guild, parentId);
    const spouseMember = spouseId ? await getSafeMemberOrUser(client, guild, spouseId) : null;
    const childMember = await getSafeMemberOrUser(client, guild, childId);

    const parentsArr = [parent1Member];
    if (spouseMember) parentsArr.push(spouseMember);

    let bannerBuffer = null;
    if (parent1Member && childMember) {
      bannerBuffer = await generateAdoptionBanner(parentsArr, childMember, now).catch(err => {
        console.error('[Relationship] Adoption banner error:', err);
        return null;
      });
    }

    const files = bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' })] : [];
    const completedDesc = `<@${childId}> has officially been adopted into the family of <@${parentId}>${spouseId ? ` and <@${spouseId}>` : ''}.`;

    await sendRelContainer(interaction, {
      description: completedDesc,
      image: bannerBuffer ? 'attachment://adopt.png' : undefined,
      footer: 'AniPedia Sanctuary',
      timestamp: Date.now(),
      files,
      components: []
    }, sendContainer);

    // If accepted in DM and origin channel is known, post to server channel
    if (!interaction.guildId && originChannelId) {
      const originChannel = client.channels.cache.get(originChannelId) || await client.channels.fetch(originChannelId).catch(() => null);
      if (originChannel && originChannel.send) {
        await sendRelContainer(originChannel, {
          description: completedDesc,
          image: bannerBuffer ? 'attachment://adopt.png' : undefined,
          footer: 'AniPedia Sanctuary',
          timestamp: Date.now(),
          files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' })] : []
        }, sendContainer).catch(() => {});
      }
    }

    // Send DM notifications
    if (childMember && interaction.user.id !== childId) {
      await sendSafeDM(childMember, {
        description: `You have officially been adopted into the family of <@${parentId}>${spouseId ? ` and <@${spouseId}>` : ''} in ${guildName}.`,
        image: bannerBuffer ? 'attachment://adopt.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' })] : []
      }, sendContainer);
    }

    if (parent1Member && interaction.user.id !== parentId) {
      await sendSafeDM(parent1Member, {
        description: `<@${childId}> has officially joined your family in ${guildName}.`,
        image: bannerBuffer ? 'attachment://adopt.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' })] : []
      }, sendContainer);
    }

    if (spouseMember && interaction.user.id !== spouseId) {
      await sendSafeDM(spouseMember, {
        description: `<@${childId}> has officially joined your family in ${guildName}.`,
        image: bannerBuffer ? 'attachment://adopt.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'adopt.png' })] : []
      }, sendContainer);
    }

    return true;
  }

  // 4. Adoption Decline
  if (customId.startsWith('rel_adopt_decline_')) {
    const parts = customId.replace('rel_adopt_decline_', '').split('_');
    const parentId = parts[0];
    const childId = parts[1];
    const originChannelId = parts[2] || null;
    const createdAt = parseInt(parts[3]) || 0;

    if (interaction.user.id !== childId) {
      await interaction.reply({
        content: `Only <@${childId}> can respond to this proposal.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    // Check 5-minute proposal expiration
    if (createdAt && (Date.now() - createdAt > PROPOSAL_EXPIRY_MS)) {
      await interaction.deferUpdate().catch(() => {});
      activePendingProposals.delete(`${parentId}_${childId}_adopt`);
      await sendRelContainer(interaction, {
        description: 'This adoption proposal has expired.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    await interaction.deferUpdate().catch(() => {});

    // Free pending proposal slot & set 15-minute rejection cooldown for parent proposing to child
    activePendingProposals.delete(`${parentId}_${childId}_adopt`);
    rejectionCooldowns.set(`${parentId}_${childId}_adopt`, Date.now() + REJECTION_COOLDOWN_MS);

    await sendRelContainer(interaction, {
      description: `<@${childId}> declined the adoption proposal from <@${parentId}>.`,
      footer: 'AniPedia Sanctuary',
      components: []
    }, sendContainer);

    if (!interaction.guildId && originChannelId) {
      const originChannel = client.channels.cache.get(originChannelId) || await client.channels.fetch(originChannelId).catch(() => null);
      if (originChannel && originChannel.send) {
        await sendRelContainer(originChannel, {
          description: `<@${childId}> declined the adoption proposal from <@${parentId}>.`,
          footer: 'AniPedia Sanctuary',
          components: []
        }, sendContainer).catch(() => {});
      }
    }

    const p1 = client.users.cache.get(parentId) || await client.users.fetch(parentId).catch(() => null);
    if (p1) {
      await sendSafeDM(p1, {
        description: `<@${childId}> declined your adoption proposal.`,
        footer: 'AniPedia Sanctuary'
      }, sendContainer);
    }
    return true;
  }

  // 5. Divorce Confirm (Dual Confirmation Required)
  if (customId.startsWith('rel_divorce_confirm_')) {
    const parts = customId.replace('rel_divorce_confirm_', '').split('_');
    const user1Id = parts[0];
    const user2Id = parts[1];

    if (interaction.user.id !== user1Id && interaction.user.id !== user2Id) {
      await interaction.reply({
        content: `Only <@${user1Id}> or <@${user2Id}> can confirm this divorce.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    const key = [user1Id, user2Id].sort().join('_');
    let confirmed = activeDivorceConfirmations.get(key);
    if (!confirmed) {
      confirmed = new Set();
      activeDivorceConfirmations.set(key, confirmed);
    }
    confirmed.add(interaction.user.id);

    if (confirmed.size < 2) {
      // First partner confirmed, waiting for second partner
      await interaction.deferUpdate().catch(() => {});
      const otherId = interaction.user.id === user1Id ? user2Id : user1Id;
      const statusDesc = `Divorce confirmation requested between <@${user1Id}> and <@${user2Id}>.\nBoth partners must confirm to proceed. Dissolving this marriage will also dissolve all associated family adoptions.\n\nStatus:\n<@${user1Id}>: ${confirmed.has(user1Id) ? 'Confirmed' : 'Pending'}\n<@${user2Id}>: ${confirmed.has(user2Id) ? 'Confirmed' : 'Pending'}\n\nWaiting for <@${otherId}> to confirm.`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rel_divorce_confirm_${user1Id}_${user2Id}`)
          .setLabel('Confirm (Yes)')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`rel_divorce_cancel_${user1Id}_${user2Id}`)
          .setLabel('Cancel (No)')
          .setStyle(ButtonStyle.Secondary)
      );

      await sendRelContainer(interaction, {
        description: statusDesc,
        footer: 'AniPedia Sanctuary',
        components: [row]
      }, sendContainer);
      return true;
    }

    // Both partners have confirmed divorce!
    activeDivorceConfirmations.delete(key);
    await interaction.deferUpdate().catch(() => {});

    // Only dissolve a marriage that still exists: an old message's buttons
    // must never be able to wipe a newer family's children.
    if (getRelationshipRecord(user1Id).spouseId !== user2Id ||
        getRelationshipRecord(user2Id).spouseId !== user1Id) {
      await sendRelContainer(interaction, {
        description: 'This marriage is no longer active, so there is nothing to dissolve.',
        footer: 'AniPedia Sanctuary',
        components: []
      }, sendContainer);
      return true;
    }

    const now = new Date();
    const rel1 = getRelationshipRecord(user1Id);
    const rel2 = getRelationshipRecord(user2Id);

    // As requested: When divorced, all family adoption ties dissolve
    const allChildren = new Set([...(rel1.childrenIds || []), ...(rel2.childrenIds || [])]);
    for (const cid of allChildren) {
      const childRec = getRelationshipRecord(cid);
      childRec.parentIds = [];
      await saveRelationshipRecord(cid, { parentIds: [] });
    }

    // Clear marriage and children
    await saveRelationshipRecord(user1Id, { spouseId: null, marriedAt: null, childrenIds: [] });
    await saveRelationshipRecord(user2Id, { spouseId: null, marriedAt: null, childrenIds: [] });

    const guild = getSafeGuild(client, interaction);
    const guildName = guild?.name || 'AniPedia';

    const u1Member = await getSafeMemberOrUser(client, guild, user1Id);
    const u2Member = await getSafeMemberOrUser(client, guild, user2Id);

    let bannerBuffer = null;
    if (u1Member && u2Member) {
      bannerBuffer = await generateDivorceBanner(u1Member, u2Member, now).catch(err => {
        console.error('[Relationship] Divorce banner error:', err);
        return null;
      });
    }

    const files = bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'divorce.png' })] : [];
    const divorceDesc = `<@${user1Id}> and <@${user2Id}> are now officially divorced. All family adoption ties have also been dissolved.`;

    await sendRelContainer(interaction, {
      description: divorceDesc,
      image: bannerBuffer ? 'attachment://divorce.png' : undefined,
      footer: 'AniPedia Sanctuary',
      timestamp: Date.now(),
      files,
      components: []
    }, sendContainer);

    // Send DM notifications to both users
    if (u1Member) {
      await sendSafeDM(u1Member, {
        description: `You and <@${user2Id}> are now officially divorced in ${guildName}. All family adoption ties have also been dissolved.`,
        image: bannerBuffer ? 'attachment://divorce.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'divorce.png' })] : []
      }, sendContainer);
    }

    if (u2Member) {
      await sendSafeDM(u2Member, {
        description: `You and <@${user1Id}> are now officially divorced in ${guildName}. All family adoption ties have also been dissolved.`,
        image: bannerBuffer ? 'attachment://divorce.png' : undefined,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        files: bannerBuffer ? [new AttachmentBuilder(bannerBuffer, { name: 'divorce.png' })] : []
      }, sendContainer);
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
        content: `Only <@${user1Id}> or <@${user2Id}> can cancel this action.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    const key = [user1Id, user2Id].sort().join('_');
    activeDivorceConfirmations.delete(key);

    await interaction.deferUpdate().catch(() => {});

    await sendRelContainer(interaction, {
      description: `Divorce cancelled by <@${interaction.user.id}>. The marriage remains intact.`,
      footer: 'AniPedia Sanctuary',
      components: []
    }, sendContainer);
    return true;
  }

  // 7. Abandon Confirm (Single parent or Dual Confirmation for two parents)
  if (customId.startsWith('rel_abandon_confirm_')) {
    const parts = customId.replace('rel_abandon_confirm_', '').split('_');
    const p1 = parts[0];
    const p2 = parts[1];
    const childId = parts[2];

    const isSingleParent = (p2 === 'none');

    if (isSingleParent) {
      if (interaction.user.id !== p1) {
        await interaction.reply({
          content: `Only <@${p1}> can confirm this action.`,
          ephemeral: isGuildInteraction
        });
        return true;
      }

      await interaction.deferUpdate().catch(() => {});

      const p1Rec = getRelationshipRecord(p1);
      const cRec = getRelationshipRecord(childId);

      p1Rec.childrenIds = (p1Rec.childrenIds || []).filter(cid => cid !== childId);
      cRec.parentIds = (cRec.parentIds || []).filter(pid => pid !== p1);

      await saveRelationshipRecord(p1, { childrenIds: p1Rec.childrenIds });
      await saveRelationshipRecord(childId, { parentIds: cRec.parentIds });

      await sendRelContainer(interaction, {
        description: `<@${childId}> has been removed from the family of <@${p1}>.`,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now(),
        components: []
      }, sendContainer);

      const guild = getSafeGuild(client, interaction);
      const guildName = guild?.name || 'AniPedia';
      const childMember = await getSafeMemberOrUser(client, guild, childId);

      if (childMember) {
        await sendSafeDM(childMember, {
          description: `You have been removed from the family of <@${p1}> in ${guildName}.`,
          footer: 'AniPedia Sanctuary',
          timestamp: Date.now()
        }, sendContainer);
      }
      return true;
    }

    // Two parents: both must confirm
    if (interaction.user.id !== p1 && interaction.user.id !== p2) {
      await interaction.reply({
        content: `Only <@${p1}> or <@${p2}> can confirm this action.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    const key = `${[p1, p2].sort().join('_')}_${childId}`;
    let confirmed = activeAbandonConfirmations.get(key);
    if (!confirmed) {
      confirmed = new Set();
      activeAbandonConfirmations.set(key, confirmed);
    }
    confirmed.add(interaction.user.id);

    if (confirmed.size < 2) {
      await interaction.deferUpdate().catch(() => {});
      const otherId = interaction.user.id === p1 ? p2 : p1;
      const desc = `Abandon confirmation requested for <@${childId}>.\nBoth parents (<@${p1}> and <@${p2}>) must confirm to remove the child from the family.\n\nStatus:\n<@${p1}>: ${confirmed.has(p1) ? 'Confirmed' : 'Pending'}\n<@${p2}>: ${confirmed.has(p2) ? 'Confirmed' : 'Pending'}\n\nWaiting for <@${otherId}> to confirm.`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rel_abandon_confirm_${p1}_${p2}_${childId}`)
          .setLabel('Confirm (Yes)')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`rel_abandon_cancel_${p1}_${p2}_${childId}`)
          .setLabel('Cancel (No)')
          .setStyle(ButtonStyle.Secondary)
      );

      await sendRelContainer(interaction, {
        description: desc,
        footer: 'AniPedia Sanctuary',
        components: [row]
      }, sendContainer);
      return true;
    }

    // Both parents confirmed!
    activeAbandonConfirmations.delete(key);
    await interaction.deferUpdate().catch(() => {});

    const p1Rec = getRelationshipRecord(p1);
    const p2Rec = getRelationshipRecord(p2);
    const cRec = getRelationshipRecord(childId);

    p1Rec.childrenIds = (p1Rec.childrenIds || []).filter(cid => cid !== childId);
    p2Rec.childrenIds = (p2Rec.childrenIds || []).filter(cid => cid !== childId);
    cRec.parentIds = (cRec.parentIds || []).filter(pid => pid !== p1 && pid !== p2);

    await saveRelationshipRecord(p1, { childrenIds: p1Rec.childrenIds });
    await saveRelationshipRecord(p2, { childrenIds: p2Rec.childrenIds });
    await saveRelationshipRecord(childId, { parentIds: cRec.parentIds });

    await sendRelContainer(interaction, {
      description: `<@${childId}> has officially been removed from the family of <@${p1}> and <@${p2}>.`,
      footer: 'AniPedia Sanctuary',
      timestamp: Date.now(),
      components: []
    }, sendContainer);

    const guild = getSafeGuild(client, interaction);
    const guildName = guild?.name || 'AniPedia';

    const childMember = await getSafeMemberOrUser(client, guild, childId);
    const p1Member = await getSafeMemberOrUser(client, guild, p1);
    const p2Member = await getSafeMemberOrUser(client, guild, p2);

    if (childMember) {
      await sendSafeDM(childMember, {
        description: `You have been removed from the family of <@${p1}> and <@${p2}> in ${guildName}.`,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now()
      }, sendContainer);
    }
    if (p1Member) {
      await sendSafeDM(p1Member, {
        description: `<@${childId}> has been removed from your family in ${guildName}.`,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now()
      }, sendContainer);
    }
    if (p2Member) {
      await sendSafeDM(p2Member, {
        description: `<@${childId}> has been removed from your family in ${guildName}.`,
        footer: 'AniPedia Sanctuary',
        timestamp: Date.now()
      }, sendContainer);
    }
    return true;
  }

  // 8. Abandon Cancel
  if (customId.startsWith('rel_abandon_cancel_')) {
    const parts = customId.replace('rel_abandon_cancel_', '').split('_');
    const p1 = parts[0];
    const p2 = parts[1];
    const childId = parts[2];

    if (interaction.user.id !== p1 && (p2 === 'none' || interaction.user.id !== p2)) {
      await interaction.reply({
        content: `Only authorized parents can cancel this action.`,
        ephemeral: isGuildInteraction
      });
      return true;
    }

    const key = `${[p1, p2].sort().join('_')}_${childId}`;
    activeAbandonConfirmations.delete(key);

    await interaction.deferUpdate().catch(() => {});

    await sendRelContainer(interaction, {
      description: `Abandon action cancelled by <@${interaction.user.id}>. <@${childId}> remains in the family.`,
      footer: 'AniPedia Sanctuary',
      components: []
    }, sendContainer);
    return true;
  }

  return false;
}

module.exports = {
  AUTHORIZED_ADMIN_IDS,
  initRelationshipFeature,
  resetAllFamilies,
  handleRelationshipCommand,
  handleRelationshipButton,
  generateMarriageBanner,
  generateAdoptionBanner,
  generateDivorceBanner,
  generateFamilyTreeBanner
};
