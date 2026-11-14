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

  // Refresh display names and avatars from guild cache if available
  const top5 = filtered.slice(0, 5);
  for (const item of top5) {
    if (guild) {
      const gMember = guild.members.cache.get(item.userId) || await guild.members.fetch(item.userId).catch(() => null);
      if (gMember) {
        item.displayName = gMember.displayName || gMember.user.username;
        item.avatarUrl = gMember.user.displayAvatarURL({ extension: 'png', size: 256 });
      }
    }
  }

  return top5;
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

  // Outer glow ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = strokeColor;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.restore();
}

/**
 * Generates the Weekly Arcane Leaderboard Graphic using Canvas
 * Inspired by podium top and sleek gaming cards bottom
 */
async function generateArcaneLeaderboardCard(type, topMembers) {
  const width = 720;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const isAura = type === 'aura';
  const primaryThemeColor = isAura ? '#bf5af2' : '#38bdf8'; // Purple for Aura, Electric Blue for IQ
  const secondaryThemeColor = isAura ? '#f5d0fe' : '#e0f2fe';
  const labelText = isAura ? 'AURA' : 'IQ';

  // 1. Background gradient (Deep Obsidian to Midnight Slate)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#0a0d14');
  bgGrad.addColorStop(0.45, '#101522');
  bgGrad.addColorStop(1, '#0c0f18');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Background glow circles
  ctx.save();
  const auraGlow = ctx.createRadialGradient(width / 2, 170, 20, width / 2, 170, 260);
  auraGlow.addColorStop(0, isAura ? 'rgba(191, 90, 242, 0.22)' : 'rgba(56, 189, 248, 0.22)');
  auraGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = auraGlow;
  ctx.beginPath();
  ctx.arc(width / 2, 170, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 2. Header
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '900 32px "Segoe UI", Montserrat, Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = primaryThemeColor;
  ctx.shadowBlur = 12;
  ctx.fillText('WEEKLY ARCANE', width / 2, 48);

  ctx.shadowBlur = 0;
  ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = primaryThemeColor;
  ctx.letterSpacing = '2px';
  ctx.fillText(`${labelText} LEADERBOARD • TOP 5 CHAMPIONS`, width / 2, 74);
  ctx.restore();

  // 3. Top 3 Podium Section
  // Positions: 2nd (Left), 1st (Center), 3rd (Right)
  const p1 = topMembers[0] || null;
  const p2 = topMembers[1] || null;
  const p3 = topMembers[2] || null;

  const podiumBaseY = 320;

  // Podium configurations:
  // Center (Rank 1): cx: 360, pedestal top: 220, avatar Y: 160
  // Left   (Rank 2): cx: 180, pedestal top: 250, avatar Y: 200
  // Right  (Rank 3): cx: 540, pedestal top: 270, avatar Y: 220

  const podiumSlots = [
    { rank: 2, data: p2, cx: 180, topY: 250, avY: 195, rad: 38, color: '#eab308', title: '2nd' },
    { rank: 1, data: p1, cx: 360, topY: 220, avY: 155, rad: 46, color: '#10b981', title: '1st' },
    { rank: 3, data: p3, cx: 540, topY: 270, avY: 215, rad: 36, color: '#ec4899', title: '3rd' }
  ];

  for (const slot of podiumSlots) {
    const { cx, topY, avY, rad, color, data, rank } = slot;
    const colW = rad * 2 + 18;

    // Draw 3D Pedestal
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, cx - colW / 2, topY, colW, podiumBaseY - topY, 14);
    const pedGrad = ctx.createLinearGradient(0, topY, 0, podiumBaseY);
    pedGrad.addColorStop(0, '#1a2233');
    pedGrad.addColorStop(1, '#0e1320');
    ctx.fillStyle = pedGrad;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = rank === 1 ? 2.5 : 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = rank === 1 ? 10 : 5;
    ctx.stroke();
    ctx.restore();

    // Draw Rank Number on Pedestal
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 24px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(String(rank), cx, topY + 36);
    ctx.restore();

    // Draw Avatar
    const avUrl = data ? data.avatarUrl : null;
    await drawCircularAvatar(ctx, avUrl, cx, avY, rad, color, rank === 1 ? 3.5 : 2.5);

    // If Rank 1, draw Crown on top
    if (rank === 1) {
      ctx.save();
      ctx.font = '28px "Segoe UI Emoji", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', cx, avY - rad - 6);
      ctx.restore();
    }

    // Name & Score under podium
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    const rawName = data ? (data.displayName || data.username) : 'Vacant';
    const truncatedName = rawName.length > 12 ? rawName.slice(0, 11) + '…' : rawName;
    ctx.fillText(truncatedName, cx, podiumBaseY + 22);

    ctx.font = '900 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = color;
    const scoreVal = data ? (isAura ? data.aura : data.iq) : 0;
    ctx.fillText(data ? `${scoreVal}%` : '---', cx, podiumBaseY + 44);
    ctx.restore();
  }

  // 4. Horizontal Separator / Banner
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(35, 385);
  ctx.lineTo(width - 35, 385);
  ctx.stroke();
  ctx.restore();

  // 5. Bottom Leaderboard List (Rank 1 to 5)
  const listStartY = 405;
  const rowHeight = 68;
  const rowSpacing = 10;

  for (let i = 0; i < 5; i++) {
    const member = topMembers[i] || null;
    const rankNum = i + 1;
    const rowY = listStartY + i * (rowHeight + rowSpacing);
    const rowW = width - 70;
    const rowX = 35;

    // Card background
    ctx.save();
    ctx.beginPath();
    drawRoundRect(ctx, rowX, rowY, rowW, rowHeight, 14);
    ctx.fillStyle = member ? 'rgba(21, 28, 44, 0.75)' : 'rgba(15, 20, 32, 0.4)';
    ctx.fill();

    const isTop3 = rankNum <= 3;
    let rankBadgeColor = '#64748b';
    if (rankNum === 1) rankBadgeColor = '#10b981';
    else if (rankNum === 2) rankBadgeColor = '#eab308';
    else if (rankNum === 3) rankBadgeColor = '#ec4899';
    else rankBadgeColor = primaryThemeColor;

    ctx.strokeStyle = member ? (isTop3 ? rankBadgeColor : 'rgba(255, 255, 255, 0.1)') : 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = isTop3 ? 1.6 : 1.0;
    if (isTop3) {
      ctx.shadowColor = rankBadgeColor;
      ctx.shadowBlur = 6;
    }
    ctx.stroke();
    ctx.restore();

    // Rank Circle Badge
    const badgeX = rowX + 32;
    const badgeY = rowY + rowHeight / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 16, 0, Math.PI * 2);
    ctx.fillStyle = rankBadgeColor;
    ctx.fill();

    ctx.font = '900 16px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0a0d14';
    ctx.fillText(String(rankNum), badgeX, badgeY + 1);
    ctx.restore();

    // User Avatar in list
    const listAvX = rowX + 82;
    const listAvY = badgeY;
    await drawCircularAvatar(ctx, member?.avatarUrl, listAvX, listAvY, 22, rankBadgeColor, 1.8);

    // Player Nickname / Name
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px "Segoe UI", Inter, Arial, sans-serif';
    ctx.fillStyle = member ? '#ffffff' : '#64748b';
    const memberName = member ? (member.displayName || member.username) : 'Empty Slot';
    const truncatedMemberName = memberName.length > 20 ? memberName.slice(0, 19) + '…' : memberName;
    ctx.fillText(truncatedMemberName, rowX + 118, badgeY - 2);

    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    const subHandle = member ? `@${member.username}` : 'Awaiting Contender';
    ctx.fillText(subHandle, rowX + 118, badgeY + 16);
    ctx.restore();

    // Score on the right
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '900 22px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = member ? '#ffffff' : '#475569';
    ctx.shadowColor = rankBadgeColor;
    ctx.shadowBlur = member && isTop3 ? 8 : 0;
    const scoreText = member ? `${isAura ? member.aura : member.iq}%` : '--%';
    ctx.fillText(scoreText, rowX + rowW - 24, badgeY);
    ctx.restore();
  }

  // Outer border glow
  ctx.save();
  ctx.beginPath();
  drawRoundRect(ctx, 3, 3, width - 6, height - 6, 20);
  ctx.strokeStyle = primaryThemeColor;
  ctx.lineWidth = 2.0;
  ctx.shadowColor = primaryThemeColor;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();

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

  let desc = `### 🏆 **Weekly Arcane • Top 5 ${label} Champions**\n`;
  if (topMembers.length === 0) {
    desc += `*No contenders have claimed a ${label} score yet this week!*`;
  } else {
    topMembers.forEach((m, idx) => {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const scoreVal = isAura ? m.aura : m.iq;
      desc += `${medals[idx] || '•'} **${m.displayName || m.username}** — \`${scoreVal}%\`\n`;
    });
  }

  const embed = new EmbedBuilder()
    .setColor(isAura ? 0xBF5AF2 : 0x38BDF8)
    .setTitle(`🌟  ${toSmallCaps(`Weekly Arcane ${label} Leaderboard`)}`)
    .setDescription(desc)
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
