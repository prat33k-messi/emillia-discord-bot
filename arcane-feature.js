/**
 * Weekly Arcane Leaderboard Feature for AniPedia
 * - Tracks and ranks top 5 server members for Aura & IQ
 * - Commands: <auraleaderboard (or <auralb, <auratop) & <iqleaderboard (or <iqlb, <iqtop)
 * - Strict Authorization: Only bot creator/master and ID 750056830654480510 can trigger
 * - Tie-breaker: If Aura is equal, IQ breaks tie (without mentioning IQ on Aura board)
 *               If IQ is equal, Aura breaks tie (without mentioning Aura on IQ board)
 * - Canvas podium + list card rendering inspired by modern esports leaderboards
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

// Authorized user IDs allowed to run Weekly Arcane commands
const AUTHORIZED_ARCANE_IDS = new Set([
  '1013822181379162142', // Aerion / Creator
  '750056830654480510'   // Authorized Admin
]);

// In-memory cache for fast leaderboard generation without database latency
// userId -> { userId, username, displayName, avatarUrl, aura, iq, updatedAt }
const arcaneScoresCache = new Map();

let dbRef = null;

/**
 * Helper to convert text to small-caps
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
 * Initializes Weekly Arcane system and preloads scores from Firestore
 */
async function initArcaneFeature(db) {
  dbRef = db;

  if (!db) {
    console.log('[Weekly Arcane] Running in in-memory mode.');
    return;
  }

  try {
    const snapshot = await db.collection('weekly_arcane_scores').get();
    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        arcaneScoresCache.set(doc.id, {
          userId: doc.id,
          username: data.username || 'User',
          displayName: data.displayName || data.username || 'User',
          avatarUrl: data.avatarUrl || null,
          aura: typeof data.aura === 'number' ? data.aura : null,
          iq: typeof data.iq === 'number' ? data.iq : null,
          updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date()
        });
      });
      console.log(`[Weekly Arcane] Loaded ${arcaneScoresCache.size} member scores from Firestore.`);
    }
  } catch (err) {
    console.error('[Weekly Arcane] Error loading scores from Firestore:', err.message);
  }
}

/**
 * Records an Aura score whenever a member rolls <aura
 */
async function recordArcaneAura(targetMember, auraPercent) {
  if (!targetMember || !targetMember.id) return;
  const userId = targetMember.id;
  const username = targetMember.user?.username || targetMember.username || 'User';
  const displayName = targetMember.displayName || username;
  const avatarUrl = targetMember.user?.displayAvatarURL
    ? targetMember.user.displayAvatarURL({ extension: 'png', size: 256 })
    : (targetMember.displayAvatarURL ? targetMember.displayAvatarURL({ extension: 'png', size: 256 }) : null);

  const existing = arcaneScoresCache.get(userId) || {
    userId,
    username,
    displayName,
    avatarUrl,
    aura: null,
    iq: null
  };

  existing.username = username;
  existing.displayName = displayName;
  if (avatarUrl) existing.avatarUrl = avatarUrl;
  existing.aura = Math.round(auraPercent);
  existing.updatedAt = new Date();

  arcaneScoresCache.set(userId, existing);

  if (dbRef) {
    dbRef.collection('weekly_arcane_scores').doc(userId).set({
      userId,
      username,
      displayName,
      avatarUrl: existing.avatarUrl || '',
      aura: existing.aura,
      iq: existing.iq,
      updatedAt: new Date()
    }, { merge: true }).catch(e => console.error('[Weekly Arcane] Firestore aura save error:', e.message));
  }
}

/**
 * Records an IQ score whenever a member rolls <iq
 */
async function recordArcaneIq(targetMember, iqScore) {
  if (!targetMember || !targetMember.id) return;
  const userId = targetMember.id;
  const username = targetMember.user?.username || targetMember.username || 'User';
  const displayName = targetMember.displayName || username;
  const avatarUrl = targetMember.user?.displayAvatarURL
    ? targetMember.user.displayAvatarURL({ extension: 'png', size: 256 })
    : (targetMember.displayAvatarURL ? targetMember.displayAvatarURL({ extension: 'png', size: 256 }) : null);

  const existing = arcaneScoresCache.get(userId) || {
    userId,
    username,
    displayName,
    avatarUrl,
    aura: null,
    iq: null
  };

  existing.username = username;
  existing.displayName = displayName;
  if (avatarUrl) existing.avatarUrl = avatarUrl;
  existing.iq = Math.round(iqScore);
  existing.updatedAt = new Date();

  arcaneScoresCache.set(userId, existing);

  if (dbRef) {
    dbRef.collection('weekly_arcane_scores').doc(userId).set({
      userId,
      username,
      displayName,
      avatarUrl: existing.avatarUrl || '',
      aura: existing.aura,
      iq: existing.iq,
      updatedAt: new Date()
    }, { merge: true }).catch(e => console.error('[Weekly Arcane] Firestore iq save error:', e.message));
  }
}

/**
 * Retrieves the Top 5 ranked members for either 'aura' or 'iq'
 * Tie-breaker logic:
 * - Aura equal -> IQ breaks tie (silent, not mentioned on aura board)
 * - IQ equal   -> Aura breaks tie (silent, not mentioned on iq board)
 */
async function getTopArcaneMembers(type, guild = null) {
  const members = Array.from(arcaneScoresCache.values());

  let filtered = [];
  if (type === 'aura') {
    filtered = members.filter(m => typeof m.aura === 'number');
    filtered.sort((a, b) => {
      if (b.aura !== a.aura) {
        return b.aura - a.aura; // Highest aura first
      }
      // Tie-breaker: IQ
      const aIq = typeof a.iq === 'number' ? a.iq : -1;
      const bIq = typeof b.iq === 'number' ? b.iq : -1;
      return bIq - aIq;
    });
  } else {
    filtered = members.filter(m => typeof m.iq === 'number');
    filtered.sort((a, b) => {
      if (b.iq !== a.iq) {
        return b.iq - a.iq; // Highest IQ first
      }
      // Tie-breaker: Aura
      const aAura = typeof a.aura === 'number' ? a.aura : -1;
      const bAura = typeof b.aura === 'number' ? b.aura : -1;
      return bAura - aAura;
    });
  }

  // Refresh display names and avatars from guild cache if available (up to 10 players)
  const top10 = filtered.slice(0, 10);
  for (const item of top10) {
    if (guild) {
      const gMember = guild.members.cache.get(item.userId) || await guild.members.fetch(item.userId).catch(() => null);
      if (gMember) {
        item.displayName = gMember.displayName || gMember.user.username;
        item.username = gMember.user.username;
        item.avatarUrl = gMember.user.displayAvatarURL({ extension: 'png', size: 256 });
      }
    }
  }

  return top10;
}

/**
 * Draws a rounded rectangle
 */
function drawRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
}

/**
 * Helper to truncate text to fit inside maximum pixel width
 */
function fitText(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

/**
 * Draws a clean user person silhouette placeholder
 */
function drawPersonSilhouette(ctx, cx, cy, size, color = '#94a3b8') {
  ctx.save();
  ctx.fillStyle = color;
  // Head
  const headR = size * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.16, headR, 0, Math.PI * 2);
  ctx.fill();

  // Torso / shoulders
  const bodyW = size * 0.72;
  const bodyTop = cy + size * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, cy + size * 0.45);
  ctx.quadraticCurveTo(cx - bodyW / 2, bodyTop, cx, bodyTop);
  ctx.quadraticCurveTo(cx + bodyW / 2, bodyTop, cx + bodyW / 2, cy + size * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws a sharp vector 4-point sparkle star so it never fails on Linux/Render fonts
 */
function drawSparkleStar(ctx, cx, cy, radius = 6, color = '#f4a6b4') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 - Math.PI / 2;
    const midAngle = angle + Math.PI / 4;
    const outerX = cx + Math.cos(angle) * radius;
    const outerY = cy + Math.sin(angle) * radius;
    const innerX = cx + Math.cos(midAngle) * (radius * 0.22);
    const innerY = cy + Math.sin(midAngle) * (radius * 0.22);
    if (i === 0) ctx.moveTo(outerX, outerY);
    else ctx.lineTo(outerX, outerY);
    ctx.quadraticCurveTo(cx, cy, innerX, innerY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// In-memory cache for custom crown image
let cachedCrownImg = null;
let crownSearchDone = false;

/**
 * Draws the Rank 1 Crown - loads custom assets/crown.png if available, or renders prominent geometric vector
 */
async function drawCrown(ctx, cx, cy, width = 76, height = 44) {
  // Check for custom crown image if not already cached
  if (!cachedCrownImg && !crownSearchDone) {
    crownSearchDone = true;
    const possiblePaths = [
      path.join(__dirname, 'assets', 'crown.png'),
      path.join(__dirname, 'crown.png'),
      path.join(process.cwd(), 'assets', 'crown.png'),
      path.join(process.cwd(), 'crown.png')
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          cachedCrownImg = await loadImage(p);
          break;
        } catch (e) {}
      }
    }
  }

  if (cachedCrownImg) {
    ctx.save();
    ctx.shadowColor = 'rgba(244, 166, 180, 0.95)';
    ctx.shadowBlur = 14;
    const imgW = cachedCrownImg.width || width;
    const imgH = cachedCrownImg.height || height;
    const ratio = imgW / imgH;
    let targetW = width;
    let targetH = width / ratio;
    if (targetH > height * 1.3) {
      targetH = height * 1.3;
      targetW = targetH * ratio;
    }
    ctx.drawImage(cachedCrownImg, cx - targetW / 2, cy - targetH / 2, targetW, targetH);
    ctx.restore();
    return;
  }

  // Fallback: Geometric Stylized Crown with floating diamonds (Solid, prominent, matching Image 2 size)
  ctx.save();
  ctx.shadowColor = 'rgba(244, 166, 180, 0.95)';
  ctx.shadowBlur = 14;

  const w2 = width / 2;
  const left = cx - w2;
  const right = cx + w2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;

  // 1. Floating Diamond jewels above the 3 peaks
  function drawDiamond(dcx, dcy, size) {
    ctx.beginPath();
    ctx.moveTo(dcx, dcy - size);
    ctx.lineTo(dcx + size * 0.7, dcy);
    ctx.lineTo(dcx, dcy + size);
    ctx.lineTo(dcx - size * 0.7, dcy);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  drawDiamond(cx, top - 3, 7.0);                                 // Center diamond (large)
  drawDiamond(left + width * 0.12, top + height * 0.22, 5.5);   // Left diamond
  drawDiamond(right - width * 0.12, top + height * 0.22, 5.5);  // Right diamond

  // 2. Solid Geometric Crown Body
  const crownGrad = ctx.createLinearGradient(cx, top, cx, bottom);
  crownGrad.addColorStop(0, '#ffffff');
  crownGrad.addColorStop(0.35, '#fff0f3');
  crownGrad.addColorStop(0.7, '#f8b4c0');
  crownGrad.addColorStop(1, '#e89fa9');
  ctx.fillStyle = crownGrad;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.6;

  ctx.beginPath();
  ctx.moveTo(left, top + height * 0.45);               // Left peak
  ctx.lineTo(left + width * 0.24, top + height * 0.72); // Left valley
  ctx.lineTo(cx, top + height * 0.12);                  // Center high peak
  ctx.lineTo(right - width * 0.24, top + height * 0.72);// Right valley
  ctx.lineTo(right, top + height * 0.45);              // Right peak
  ctx.lineTo(right - width * 0.14, bottom);            // Right base
  ctx.lineTo(cx, bottom - height * 0.18);              // Bottom notch
  ctx.lineTo(left + width * 0.14, bottom);             // Left base
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Solid Base Band
  ctx.fillStyle = '#e89fa9';
  ctx.fillRect(left + width * 0.12, bottom - 3.5, width * 0.76, 3.5);

  // Jewel dots on peak tips
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(left + 1, top + height * 0.45, 2.2, 0, Math.PI * 2);
  ctx.arc(cx, top + height * 0.12, 2.8, 0, Math.PI * 2);
  ctx.arc(right - 1, top + height * 0.45, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Inner geometric V accent
  ctx.beginPath();
  ctx.moveTo(cx - width * 0.18, top + height * 0.6);
  ctx.lineTo(cx, top + height * 0.38);
  ctx.lineTo(cx + width * 0.18, top + height * 0.6);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 2.0;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws a circular avatar with border and silhouette fallback
 */
async function drawCircularAvatar(ctx, avatarUrl, cx, cy, radius, strokeColor, lineWidth = 1.5) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = '#e2e8f0';
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
    drawPersonSilhouette(ctx, cx, cy, radius * 1.7, '#94a3b8');
  }

  ctx.restore();

  if (strokeColor && lineWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Draws a square avatar with rounded corners, dark gradient background, and glowing border
 */
async function drawSquareAvatar(ctx, avatarUrl, x, y, size, strokeColor, lineWidth = 2.5, cornerRadius = 18) {
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, x, y, size, size, cornerRadius);
  ctx.closePath();
  ctx.clip();

  // Dark placeholder fill
  const darkGrad = ctx.createLinearGradient(x, y, x, y + size);
  darkGrad.addColorStop(0, '#1a2333');
  darkGrad.addColorStop(1, '#0e1522');
  ctx.fillStyle = darkGrad;
  ctx.fillRect(x, y, size, size);

  let loaded = false;
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      const imgW = img.width || size;
      const imgH = img.height || size;
      const minDim = Math.min(imgW, imgH);
      const sx = (imgW - minDim) / 2;
      const sy = (imgH - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, x, y, size, size);
      loaded = true;
    } catch (e) {
      loaded = false;
    }
  }

  if (!loaded) {
    drawPersonSilhouette(ctx, x + size / 2, y + size / 2, size * 0.82, '#94a3b8');
  }

  ctx.restore();

  // Glowing outer border
  if (strokeColor && lineWidth > 0) {
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, x, y, size, size, cornerRadius);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = strokeColor;
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Calculates rank delta / movement between previous and current rank
 */
function getRankDelta(currRank, prevRank) {
  if (typeof prevRank !== 'number' || prevRank <= 0) {
    return { text: '-', color: '#94a3b8', diff: 0, arrow: '' };
  }
  if (currRank < prevRank) {
    const diff = prevRank - currRank;
    return { text: `▲ +${diff}`, color: '#10b981', diff, arrow: '▲' };
  }
  if (currRank > prevRank) {
    const diff = currRank - prevRank;
    return { text: `▼ -${diff}`, color: '#ef4444', diff: -diff, arrow: '▼' };
  }
  return { text: '-', color: '#94a3b8', diff: 0, arrow: '' };
}

/**
 * Generates the Weekly Arcane Leaderboard Graphic using Canvas
 * Inspired by modern anime/esports podium design (Top 3 neon cards + clean white table for Ranks 4-10)
 */
async function generateArcaneLeaderboardCard(type, topMembers) {
  const width = 760;
  const isAura = type === 'aura';
  const labelText = isAura ? 'AURA' : 'IQ';

  const bottomMembers = topMembers.slice(3, 10);
  const rowCount = Math.max(1, bottomMembers.length);
  const rowHeight = 82;
  const panelH = rowCount * rowHeight + 16;
  const panelY = 466;
  const height = panelY + panelH + 30;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Overall Dark Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#050811');
  bgGrad.addColorStop(0.3, '#080e1e');
  bgGrad.addColorStop(0.7, '#070c1a');
  bgGrad.addColorStop(1, '#04070f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Ambient rose-gold glowing curved accents in corners
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(244, 166, 180, 0.45)';
  ctx.shadowColor = '#f4a6b4';
  ctx.shadowBlur = 12;

  // Left swoosh
  ctx.beginPath();
  ctx.moveTo(0, 95);
  ctx.bezierCurveTo(60, 45, 140, 15, 260, 8);
  ctx.stroke();

  // Right swoosh
  ctx.beginPath();
  ctx.moveTo(520, 8);
  ctx.bezierCurveTo(640, 18, 710, 60, width, 85);
  ctx.stroke();

  // Second thinner glowing accent curve
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(244, 166, 180, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, 110);
  ctx.bezierCurveTo(70, 60, 160, 25, 290, 18);
  ctx.stroke();
  ctx.restore();

  // 2. Top Left: Title & Sparkle
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const headerY = 38;

  // "AURA RANKING " in bold italic white
  ctx.font = 'italic 900 22px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  const titlePart1 = `${labelText} RANKING `;
  ctx.fillText(titlePart1, 28, headerY);
  const part1Width = ctx.measureText(titlePart1).width;

  // "OF THE WEEK" in soft dusty rose bold italic
  ctx.fillStyle = '#f4a6b4';
  ctx.fillText('OF THE WEEK', 28 + part1Width, headerY);

  // Sparkle star with thin rose-gold line underneath (rendered via vector so it never fails on Linux/Render)
  const starX = 28 + (part1Width + ctx.measureText('OF THE WEEK').width) / 2;
  const lineY = headerY + 18;
  ctx.strokeStyle = 'rgba(244, 166, 180, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(starX - 45, lineY);
  ctx.lineTo(starX - 10, lineY);
  ctx.moveTo(starX + 10, lineY);
  ctx.lineTo(starX + 45, lineY);
  ctx.stroke();

  drawSparkleStar(ctx, starX, lineY, 6, '#f4a6b4');
  ctx.restore();

  // 3. Top Right: ANIPEDIA Header
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '900 19px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ANIPEDIA', width - 28, headerY);
  ctx.restore();

  // 4. Podium Cards (Top 3)
  // 2nd Place (Left, Slate Blue), 1st Place (Center, Sage Green, Elevated), 3rd Place (Right, Dusty Rose)
  const p1 = topMembers[0] || null;
  const p2 = topMembers[1] || null;
  const p3 = topMembers[2] || null;

  const podiumCards = [
    {
      rank: 2,
      data: p2,
      x: 28,
      y: 114,
      w: 224,
      h: 332,
      accent: '#7098b0',
      bgTop: '#0c1622',
      bgBot: '#060c13',
      numColor: '#ffffff',
      numFont: '900 48px "Segoe UI", Arial Black, Impact, sans-serif',
      numX: 28 + 22,
      numY: 114 + 14,
      boxX: 56,
      boxY: 182,
      boxSize: 168
    },
    {
      rank: 1,
      data: p1,
      x: 268,
      y: 74,
      w: 224,
      h: 372,
      accent: '#8ba870',
      bgTop: '#111e0f',
      bgBot: '#081008',
      numColor: '#ffffff',
      numFont: 'italic 900 50px "Segoe UI", Arial Black, Impact, sans-serif',
      numX: 268 + 24,
      numY: 74 + 12,
      boxX: 292,
      boxY: 152,
      boxSize: 176
    },
    {
      rank: 3,
      data: p3,
      x: 508,
      y: 134,
      w: 224,
      h: 312,
      accent: '#b87070',
      bgTop: '#200c0c',
      bgBot: '#100606',
      numColor: '#ffffff',
      numFont: '900 46px "Segoe UI", Arial Black, Impact, sans-serif',
      numX: 508 + 22,
      numY: 134 + 14,
      boxX: 539,
      boxY: 198,
      boxSize: 162
    }
  ];

  for (const card of podiumCards) {
    const { rank, data, x, y, w, h, accent, bgTop, bgBot, numColor, numFont, numX, numY, boxX, boxY, boxSize } = card;
    const cardRadius = 20;
    const barHeight = 66;
    const barY = y + h - barHeight;

    // Clip to rounded card
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, x, y, w, h, cardRadius);
    ctx.clip();

    // Background gradient
    const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
    cardGrad.addColorStop(0, bgTop);
    cardGrad.addColorStop(0.75, bgBot);
    cardGrad.addColorStop(1, '#05070d');
    ctx.fillStyle = cardGrad;
    ctx.fillRect(x, y, w, h);

    // Rounded square avatar box
    await drawSquareAvatar(ctx, data?.avatarUrl, boxX, boxY, boxSize, accent, rank === 1 ? 2.8 : 2.5, 18);

    // Crown for Rank 1 (Enlarged to match Image 2)
    if (rank === 1) {
      await drawCrown(ctx, x + 130, y + 40, 76, 44);
    }

    // Rank Number
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = numFont;
    ctx.fillStyle = numColor;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(String(rank), numX, numY);
    ctx.restore();

    // Solid Neon Bottom Bar
    ctx.fillStyle = accent;
    ctx.fillRect(x, barY, w, barHeight);

    // Display Name & Username & Score
    const rawDisp = data ? (data.displayName || data.username) : 'Display Name';
    const cleanDisp = rawDisp.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
    const rawUser = data ? (data.username ? `@${data.username}` : 'user') : 'user';
    const cleanUser = rawUser.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();

    const scoreVal = data ? (isAura ? data.aura : data.iq) : null;
    const scoreText = typeof scoreVal === 'number' ? `${scoreVal}%` : '-';

    // Large prominent Score on right (2.5x larger: 28px bold)
    ctx.save();
    ctx.font = '900 28px "Segoe UI", Montserrat, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 4;
    ctx.fillText(scoreText, x + w - 14, barY + barHeight / 2);
    const scoreW = ctx.measureText(scoreText).width;
    ctx.restore();

    // User details on left
    ctx.save();
    const maxDispW = w - scoreW - 24;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Display Name (top row)
    ctx.font = 'bold 16px "Segoe UI", Montserrat, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitText(ctx, cleanDisp, maxDispW), x + 12, barY + 23);

    // @username (bottom row)
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillText(fitText(ctx, cleanUser, maxDispW), x + 12, barY + 45);
    ctx.restore();

    ctx.restore(); // Exit card clipping

    // Outer Glowing Border Stroke
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, x, y, w, h, cardRadius);
    ctx.strokeStyle = accent;
    ctx.lineWidth = rank === 1 ? 3.5 : 2.8;
    ctx.shadowColor = accent;
    ctx.shadowBlur = rank === 1 ? 16 : 14;
    ctx.stroke();
    ctx.restore();
  }

  // 5. Bottom Panel: Ranks 4 to 10 (Clean Modern Warm Blush Panel)
  const panelX = 28;
  const panelW = 704;

  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 20);
  ctx.fillStyle = '#fbf0ef';
  ctx.fill();

  ctx.strokeStyle = '#ecd8d6';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (bottomMembers.length === 0) {
    const rowCenterY = panelY + panelH / 2;
    ctx.save();
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#a0aec0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Awaiting contenders for Ranks 4 to 10...', panelX + panelW / 2, rowCenterY);
    ctx.restore();
  } else {
    for (let i = 0; i < bottomMembers.length; i++) {
      const member = bottomMembers[i];
      const rankNum = i + 4;
      const rowY = panelY + 8 + i * rowHeight;
      const rowCenterY = rowY + rowHeight / 2;

      // 1. Rank Number (Enlarged 24px)
      ctx.save();
      ctx.font = '900 24px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2d3748';
      ctx.fillText(String(rankNum), panelX + 30, rowCenterY);

      // 2. Dash separator (Enlarged 20px)
      ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#a0aec0';
      ctx.fillText('-', panelX + 58, rowCenterY);
      ctx.restore();

      // 3. Circular Avatar (Enlarged to radius 28px / diameter 56px - 2x visual size!)
      const avX = panelX + 98;
      await drawCircularAvatar(ctx, member.avatarUrl, avX, rowCenterY, 28, '#ecd8d6', 2.0);

      // 4. Two Lines of User Info (Enlarged 2x!)
      const rawDisp = member.displayName || member.username;
      const cleanDisp = rawDisp.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
      const rawUser = member.username ? `@${member.username}` : 'user';
      const cleanUser = rawUser.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();

      const scoreVal = isAura ? member.aura : member.iq;
      const scoreText = typeof scoreVal === 'number' ? `${scoreVal}%` : '-';

      // Measure score text on right (Enlarged 28px bold)
      ctx.save();
      ctx.font = '900 28px "Segoe UI", Montserrat, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1a202c';
      ctx.fillText(scoreText, panelX + panelW - 24, rowCenterY);
      const scoreW = ctx.measureText(scoreText).width;

      // Rank Movement Delta (e.g. ▲ +5 / ▼ -2) if any
      const prevRank = isAura ? member.previousAuraRank : member.previousIqRank;
      const delta = getRankDelta(rankNum, prevRank);
      let deltaW = 0;
      if (delta.diff !== 0) {
        ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = delta.color;
        ctx.fillText(delta.text, panelX + panelW - 32 - scoreW, rowCenterY);
        deltaW = ctx.measureText(delta.text).width + 8;
      }

      // Display Name (Line 1 - Enlarged 20px bold!)
      ctx.textAlign = 'left';
      ctx.font = 'bold 20px "Segoe UI", Montserrat, Arial, sans-serif';
      ctx.fillStyle = '#1a202c';
      const maxTextW = panelW - 150 - scoreW - deltaW - 30;
      ctx.fillText(fitText(ctx, cleanDisp, maxTextW), panelX + 138, rowCenterY - 12);

      // Username (Line 2 - Enlarged 15px!)
      ctx.font = '15px "Segoe UI", Arial, sans-serif';
      ctx.fillStyle = '#718096';
      ctx.fillText(fitText(ctx, cleanUser, maxTextW), panelX + 138, rowCenterY + 14);
      ctx.restore();

      // Divider line between rows
      if (i < bottomMembers.length - 1) {
        ctx.save();
        ctx.strokeStyle = '#eedad8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(panelX + 24, rowY + rowHeight);
        ctx.lineTo(panelX + panelW - 24, rowY + rowHeight);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return canvas.toBuffer('image/png');
}

/**
 * Handles <auraleaderboard and <iqleaderboard execution with Container V2 styling
 */
async function handleArcaneLeaderboardCommand(message, type, client, sendContainer = null) {
  const authorId = message.author.id;
  const isMaster = message.author.id === '1013822181379162142' || AUTHORIZED_ARCANE_IDS.has(authorId);

  // Strict authorization check
  if (!isMaster) {
    await message.reply("Mou! 🌸 Only authorized guardians can summon the Weekly Arcane Leaderboard! ❄️");
    return;
  }

  await message.channel.sendTyping().catch(() => {});

  const guild = message.guild;
  const topMembers = await getTopArcaneMembers(type, guild);

  const isAura = type === 'aura';
  const label = isAura ? 'Aura' : 'IQ';
  const cardBuffer = await generateArcaneLeaderboardCard(type, topMembers);
  const attachment = new AttachmentBuilder(cardBuffer, { name: `${type}_leaderboard.png` });

  if (typeof sendContainer === 'function') {
    await sendContainer(message, {
      title: `🌟  ${toSmallCaps(`Weekly Arcane ${label} Leaderboard`)}`,
      description: `### 🏆 **Weekly Arcane**`,
      image: `attachment://${type}_leaderboard.png`,
      footer: `${toSmallCaps('AniPedia Weekly Arcane')} • ${guild?.name || 'Sanctuary'}`,
      timestamp: Date.now(),
      files: [attachment]
    });
  } else {
    const embed = new EmbedBuilder()
      .setColor(isAura ? 0xBF5AF2 : 0x38BDF8)
      .setTitle(`🌟  ${toSmallCaps(`Weekly Arcane ${label} Leaderboard`)}`)
      .setDescription(`### 🏆 **Weekly Arcane**`)
      .setImage(`attachment://${type}_leaderboard.png`)
      .setFooter({ text: `${toSmallCaps('AniPedia Weekly Arcane')} • ${guild?.name || 'Sanctuary'}`, iconURL: guild?.iconURL() || client.user.displayAvatarURL() })
      .setTimestamp();

    await message.reply({ embeds: [embed], files: [attachment] });
  }
}

/**
 * Resets Aura records for a specific member or all members
 * Snapshots previous ranks before wiping scores so rank movement indicators work!
 */
async function resetArcaneAura(targetUserId = null) {
  const currentTop = await getTopArcaneMembers('aura');
  const rankMap = new Map();
  currentTop.forEach((m, idx) => {
    rankMap.set(m.userId, idx + 1);
  });

  if (targetUserId) {
    const existing = arcaneScoresCache.get(targetUserId);
    if (existing) {
      if (rankMap.has(targetUserId)) {
        existing.previousAuraRank = rankMap.get(targetUserId);
      }
      existing.aura = null;
      if (existing.iq === null && !existing.previousAuraRank && !existing.previousIqRank) {
        arcaneScoresCache.delete(targetUserId);
      }
    }
    if (dbRef) {
      const prevRank = rankMap.get(targetUserId) || null;
      await dbRef.collection('weekly_arcane_scores').doc(targetUserId).set({
        aura: null,
        ...(prevRank ? { previousAuraRank: prevRank } : {}),
        updatedAt: new Date()
      }, { merge: true }).catch(e => console.error('[Weekly Arcane] Firestore aura reset error:', e.message));
    }
  } else {
    for (const [uid, item] of arcaneScoresCache.entries()) {
      if (rankMap.has(uid)) {
        item.previousAuraRank = rankMap.get(uid);
      }
      item.aura = null;
    }
    if (dbRef) {
      try {
        const snap = await dbRef.collection('weekly_arcane_scores').get();
        if (!snap.empty) {
          const batch = dbRef.batch();
          snap.forEach(doc => {
            const prevRank = rankMap.get(doc.id) || null;
            batch.set(doc.ref, {
              aura: null,
              ...(prevRank ? { previousAuraRank: prevRank } : {}),
              updatedAt: new Date()
            }, { merge: true });
          });
          await batch.commit();
        }
      } catch (e) {
        console.error('[Weekly Arcane] Firestore batch aura reset error:', e.message);
      }
    }
  }
}

/**
 * Resets IQ records for a specific member or all members
 * Snapshots previous ranks before wiping scores so rank movement indicators work!
 */
async function resetArcaneIq(targetUserId = null) {
  const currentTop = await getTopArcaneMembers('iq');
  const rankMap = new Map();
  currentTop.forEach((m, idx) => {
    rankMap.set(m.userId, idx + 1);
  });

  if (targetUserId) {
    const existing = arcaneScoresCache.get(targetUserId);
    if (existing) {
      if (rankMap.has(targetUserId)) {
        existing.previousIqRank = rankMap.get(targetUserId);
      }
      existing.iq = null;
      if (existing.aura === null && !existing.previousAuraRank && !existing.previousIqRank) {
        arcaneScoresCache.delete(targetUserId);
      }
    }
    if (dbRef) {
      const prevRank = rankMap.get(targetUserId) || null;
      await dbRef.collection('weekly_arcane_scores').doc(targetUserId).set({
        iq: null,
        ...(prevRank ? { previousIqRank: prevRank } : {}),
        updatedAt: new Date()
      }, { merge: true }).catch(e => console.error('[Weekly Arcane] Firestore iq reset error:', e.message));
    }
  } else {
    for (const [uid, item] of arcaneScoresCache.entries()) {
      if (rankMap.has(uid)) {
        item.previousIqRank = rankMap.get(uid);
      }
      item.iq = null;
    }
    if (dbRef) {
      try {
        const snap = await dbRef.collection('weekly_arcane_scores').get();
        if (!snap.empty) {
          const batch = dbRef.batch();
          snap.forEach(doc => {
            const prevRank = rankMap.get(doc.id) || null;
            batch.set(doc.ref, {
              iq: null,
              ...(prevRank ? { previousIqRank: prevRank } : {}),
              updatedAt: new Date()
            }, { merge: true });
          });
          await batch.commit();
        }
      } catch (e) {
        console.error('[Weekly Arcane] Firestore batch iq reset error:', e.message);
      }
    }
  }
}

module.exports = {
  AUTHORIZED_ARCANE_IDS,
  arcaneScoresCache,
  initArcaneFeature,
  recordArcaneAura,
  recordArcaneIq,
  getTopArcaneMembers,
  generateArcaneLeaderboardCard,
  handleArcaneLeaderboardCommand,
  resetArcaneAura,
  resetArcaneIq
};
