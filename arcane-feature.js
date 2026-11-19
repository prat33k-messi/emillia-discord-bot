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

  // Pre-seed known fixed stats
  arcaneScoresCache.set('1527723712122720257', {
    userId: '1527723712122720257',
    username: 'GOOD HUMAN',
    displayName: 'GOOD HUMAN',
    avatarUrl: null,
    aura: 98,
    iq: 99,
    updatedAt: new Date()
  });

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
 * Draws a sharp gold crown above Rank 1 avatar
 */
function drawCrown(ctx, cx, cy, width = 38, height = 22) {
  ctx.save();
  ctx.fillStyle = '#fbbf24';
  ctx.shadowColor = '#fbbf24';
  ctx.shadowBlur = 10;
  const w2 = width / 2;
  const left = cx - w2;
  const right = cx + w2;
  const top = cy - height / 2;
  const bottom = cy + height / 2;

  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, top + height * 0.35);
  ctx.lineTo(left + width * 0.25, top + height * 0.6);
  ctx.lineTo(cx, top);
  ctx.lineTo(right - width * 0.25, top + height * 0.6);
  ctx.lineTo(right, top + height * 0.35);
  ctx.lineTo(right, bottom);
  ctx.closePath();
  ctx.fill();

  // Jewel dots on crown tips
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(left + 2, top + height * 0.35, 2.5, 0, Math.PI * 2);
  ctx.arc(cx, top + 1, 2.8, 0, Math.PI * 2);
  ctx.arc(right - 2, top + height * 0.35, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Draws a circular avatar with border
 */
async function drawCircularAvatar(ctx, avatarUrl, cx, cy, radius, strokeColor, lineWidth = 3) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = '#1e2330';
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    } catch (e) {
      ctx.fillStyle = '#374151';
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
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
 * Generates the Weekly Arcane Leaderboard Graphic using Canvas
 * Inspired by F1 Grand Prix Podium (Top 3) + Clean White Panel (Ranks 4-10)
 */
async function generateArcaneLeaderboardCard(type, topMembers) {
  const width = 760;
  const isAura = type === 'aura';
  const labelText = isAura ? 'AURA' : 'IQ';

  const bottomMembers = topMembers.slice(3, 10);
  const rowCount = Math.max(1, bottomMembers.length);
  const rowHeight = 48;
  const panelH = rowCount * rowHeight + 16;
  const panelY = 468;
  const height = panelY + panelH + 25;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Overall Dark Background
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#090c13');
  bgGrad.addColorStop(0.5, '#0e1422');
  bgGrad.addColorStop(1, '#090c13');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Red/accent plus pattern (+ + + + +) on top left
  ctx.save();
  ctx.font = '12px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
  for (let px = 25; px < 160; px += 16) {
    for (let py = 18; py < 45; py += 12) {
      ctx.fillText('+', px, py);
    }
  }
  ctx.restore();

  // 2. Top Right: ANIPEDIA + Flag (Austrian GP inspired)
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = '900 18px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ANIPEDIA', width - 60, 36);

  const flagX = width - 52;
  const flagY = 28;
  const flagW = 26;
  const flagH = 16;
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(flagX, flagY, flagW, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(flagX, flagY + 5, flagW, 6);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(flagX, flagY + 11, flagW, 5);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(flagX, flagY, flagW, flagH);
  ctx.restore();

  // 3. Top Left: Subtitle & Title
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 12px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('WEEKLY ARCANE', 25, 30);

  ctx.font = '900 22px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${labelText} LEADERBOARD`, 25, 52);
  ctx.restore();

  // 4. Podium Cards (Top 3)
  // 2nd Place (Left, Orange), 1st Place (Center, Teal, Elevated), 3rd Place (Right, Red)
  const p1 = topMembers[0] || null;
  const p2 = topMembers[1] || null;
  const p3 = topMembers[2] || null;

  const podiumCards = [
    {
      rank: 2,
      data: p2,
      x: 25,
      y: 115,
      w: 225,
      h: 330,
      accent: '#ff8000',
      bgTop: '#261509',
      bgBot: '#100a06',
      stencilSize: 85,
      avY: 235,
      avRad: 52,
      barTextColor: '#000000'
    },
    {
      rank: 1,
      data: p1,
      x: 267,
      y: 75,
      w: 225,
      h: 370,
      accent: '#00d2be',
      bgTop: '#082822',
      bgBot: '#051412',
      stencilSize: 95,
      avY: 220,
      avRad: 62,
      barTextColor: '#000000'
    },
    {
      rank: 3,
      data: p3,
      x: 510,
      y: 135,
      w: 225,
      h: 310,
      accent: '#ef4444',
      bgTop: '#290909',
      bgBot: '#120505',
      stencilSize: 80,
      avY: 250,
      avRad: 48,
      barTextColor: '#ffffff'
    }
  ];

  for (const card of podiumCards) {
    const { rank, data, x, y, w, h, accent, bgTop, bgBot, stencilSize, avY, avRad, barTextColor } = card;
    const cardRadius = 16;
    const barHeight = 48;
    const barY = y + h - barHeight;

    // Clip to rounded card
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, x, y, w, h, cardRadius);
    ctx.clip();

    // Background gradient
    const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
    cardGrad.addColorStop(0, bgTop);
    cardGrad.addColorStop(0.7, bgBot);
    cardGrad.addColorStop(1, '#05070a');
    ctx.fillStyle = cardGrad;
    ctx.fillRect(x, y, w, h);

    // Subtle diagonal racing speed lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let lx = x - 60; lx < x + w + 100; lx += 20) {
      ctx.beginPath();
      ctx.moveTo(lx, y);
      ctx.lineTo(lx - 40, y + h);
      ctx.stroke();
    }
    ctx.restore();

    // Large Stencil Rank Number in top-left
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `900 ${stencilSize}px "Segoe UI", Arial Black, Impact, sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillText(String(rank), x + 16, y + 10);
    ctx.restore();

    // Circular Avatar
    const avX = x + w / 2;
    await drawCircularAvatar(ctx, data?.avatarUrl, avX, avY, avRad, accent, rank === 1 ? 4 : 3);

    // Gold Crown for Rank 1
    if (rank === 1) {
      drawCrown(ctx, avX, avY - avRad - 18, 42, 24);
    }

    // Solid Bottom Bar (Driver name & score)
    ctx.fillStyle = accent;
    ctx.fillRect(x, barY, w, barHeight);

    const rawName = data ? (data.displayName || data.username) : 'VACANT';
    const cleanName = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().toUpperCase();
    const scoreVal = data ? (isAura ? data.aura : data.iq) : null;
    const scoreText = typeof scoreVal === 'number' ? `${scoreVal}%` : '--%';

    ctx.save();
    ctx.font = '900 18px "Segoe UI", Montserrat, Arial, sans-serif';
    const scoreW = ctx.measureText(scoreText).width;

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = barTextColor;
    ctx.fillText(scoreText, x + w - 14, barY + barHeight / 2);

    ctx.textAlign = 'left';
    ctx.font = '900 16px "Segoe UI", Montserrat, Arial, sans-serif';
    ctx.fillStyle = barTextColor;
    const maxNameW = w - scoreW - 32;
    const fittedName = fitText(ctx, cleanName, maxNameW);
    ctx.fillText(fittedName, x + 14, barY + barHeight / 2);
    ctx.restore();

    ctx.restore(); // Exit card clipping

    // Outer card border stroke
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, x, y, w, h, cardRadius);
    ctx.strokeStyle = accent;
    ctx.lineWidth = rank === 1 ? 2.5 : 1.8;
    if (rank === 1) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 10;
    }
    ctx.stroke();
    ctx.restore();
  }

  // 5. Bottom Panel: Ranks 4 to 10 (Clean Modern White Panel)
  const panelX = 25;
  const panelW = 710;

  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, panelX, panelY, panelW, panelH, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (bottomMembers.length === 0) {
    ctx.save();
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Awaiting contenders for Ranks 4 to 10...', panelX + panelW / 2, panelY + panelH / 2);
    ctx.restore();
  } else {
    for (let i = 0; i < bottomMembers.length; i++) {
      const member = bottomMembers[i];
      const rankNum = i + 4;
      const rowY = panelY + 8 + i * rowHeight;
      const rowCenterY = rowY + rowHeight / 2;

      // Rank Number
      ctx.save();
      ctx.font = '900 18px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(String(rankNum), panelX + 32, rowCenterY);
      ctx.restore();

      // Avatar
      const avX = panelX + 74;
      await drawCircularAvatar(ctx, member.avatarUrl, avX, rowCenterY, 16, '#cbd5e1', 1.5);

      // Name & Score
      ctx.save();
      ctx.font = '900 15px "Segoe UI", Montserrat, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      const rawName = member.displayName || member.username;
      const cleanName = rawName.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().toUpperCase();

      const scoreVal = isAura ? member.aura : member.iq;
      const scoreText = typeof scoreVal === 'number' ? `${scoreVal}%` : '--%';

      ctx.save();
      ctx.font = '900 17px "Segoe UI", Montserrat, Arial, sans-serif';
      const scoreW = ctx.measureText(scoreText).width;
      ctx.restore();

      const maxNameW = panelW - 130 - scoreW - 30;
      const fittedName = fitText(ctx, cleanName, maxNameW);
      ctx.fillText(fittedName, panelX + 104, rowCenterY);

      // Score on right
      ctx.font = '900 17px "Segoe UI", Montserrat, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(scoreText, panelX + panelW - 24, rowCenterY);
      ctx.restore();

      // Divider line between rows
      if (i < bottomMembers.length - 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(panelX + 20, rowY + rowHeight);
        ctx.lineTo(panelX + panelW - 20, rowY + rowHeight);
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  return canvas.toBuffer('image/png');
}

/**
 * Handles <auraleaderboard and <iqleaderboard execution
 */
async function handleArcaneLeaderboardCommand(message, type, client) {
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

  const embed = new EmbedBuilder()
    .setColor(isAura ? 0xBF5AF2 : 0x38BDF8)
    .setTitle(`🌟  ${toSmallCaps(`Weekly Arcane ${label} Leaderboard`)}`)
    .setDescription(`### 🏆 **Weekly Arcane**`)
    .setImage(`attachment://${type}_leaderboard.png`)
    .setFooter({ text: `${toSmallCaps('AniPedia Weekly Arcane')} • ${guild?.name || 'Sanctuary'}`, iconURL: guild?.iconURL() || client.user.displayAvatarURL() })
    .setTimestamp();

  await message.reply({ embeds: [embed], files: [attachment] });
}

module.exports = {
  AUTHORIZED_ARCANE_IDS,
  arcaneScoresCache,
  initArcaneFeature,
  recordArcaneAura,
  recordArcaneIq,
  getTopArcaneMembers,
  generateArcaneLeaderboardCard,
  handleArcaneLeaderboardCommand
};
