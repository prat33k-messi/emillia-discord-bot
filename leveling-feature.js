const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// ==========================================
// CONFIGURATION & CONSTANTS (MATCHING WABBITBOT EXACTLY)
// ==========================================
const MASTER_USER_ID = '1013822181379162142';
const TESTING_CHANNEL_ID = '1555229239727493150';
const DEFAULT_ANNOUNCE_CHANNEL_NAME = 'rank-check';

// Testing Mode Flag:
// When true, automatic message XP & level effects are strictly limited to testing channel & Master
let LEVELING_TEST_MODE = true;

// XP Math: Linear Curve with Factor 200
// Next Level XP required for Level L = L * 200
// Level 1 -> 200 XP
// Level 71 -> 14,200 XP
// Level 100 -> 20,000 XP
// Level 102 -> 20,400 XP
const CURVE_FACTOR = 200;

// Message XP Settings
const MIN_MESSAGE_XP = 30;
const MAX_MESSAGE_XP = 40;
const MESSAGE_XP_COOLDOWN_MS = (2 * 60 + 25) * 1000; // 2 minutes 25 seconds = 145,000 ms

// Voice XP Settings (every 30 seconds: 3-5 XP -> 6-10 XP per minute)
const MIN_VOICE_XP = 3;
const MAX_VOICE_XP = 5;

// Blacklisted channels from gaining XP
const NO_XP_CHANNELS = new Set([
  'staff-chat',
  'rank-check',
  'art',
  'manga-pannels',
  'pokemon',
  'owo',
  'mudae',
  'nekotina',
  'bot-setup',
  'playlists'
]);

// Milestone Level Roles to auto-grant (Stack role rewards = ON)
const LEVEL_ROLE_TIERS = [
  { minLevel: 60, name: 'Level 60+' },
  { minLevel: 50, name: 'Level 50+' },
  { minLevel: 40, name: 'Level 40+' },
  { minLevel: 30, name: 'Level 30+' },
  { minLevel: 20, name: 'Level 20+' },
  { minLevel: 10, name: 'Level 10+' },
  { minLevel: 5,  name: 'Level 5+'  }
];

// In-memory cache for ultra-fast access
const userLevelsCache = new Map();
const userXpCooldowns = new Map();
const userVoiceJoinTimes = new Map();

/**
 * Calculates XP required to advance from level to level + 1
 */
function getXpNeededForNextLevel(level) {
  const lvl = Math.max(1, level);
  return lvl * CURVE_FACTOR;
}

/**
 * Calculates cumulative total XP up to level
 */
function getTotalXpForLevel(level) {
  if (level <= 1) return 0;
  // sum_{i=1}^{level-1} (i * 200) = 100 * level * (level - 1)
  return 100 * level * (level - 1);
}

/**
 * Gets or initializes user leveling data
 */
async function getUserLevelData(userId, username = 'Unknown', db = null) {
  if (userLevelsCache.has(userId)) {
    return userLevelsCache.get(userId);
  }

  let data = {
    userId,
    username,
    level: 1,
    currentXp: 0,
    totalXp: 0,
    messagesCount: 0,
    voiceSeconds: 0,
    lastXpTimestamp: 0
  };

  if (db) {
    try {
      const doc = await db.collection('user_levels').doc(userId).get();
      if (doc.exists) {
        data = { ...data, ...doc.data() };
      }
    } catch (err) {
      console.error(`[Leveling] Error loading data for ${userId}:`, err.message);
    }
  }

  userLevelsCache.set(userId, data);
  return data;
}

/**
 * Saves user level data to cache and Firestore
 */
async function saveUserLevelData(userId, data, db = null) {
  userLevelsCache.set(userId, data);
  if (db) {
    try {
      await db.collection('user_levels').doc(userId).set({
        ...data,
        lastUpdated: new Date()
      }, { merge: true });
    } catch (err) {
      console.error(`[Leveling] Error saving data for ${userId}:`, err.message);
    }
  }
}

/**
 * Grants matching level milestone roles to member
 */
async function syncMemberLevelRoles(member, currentLevel) {
  if (!member || !member.roles || !member.guild) return [];
  const addedRoles = [];

  for (const tier of LEVEL_ROLE_TIERS) {
    if (currentLevel >= tier.minLevel) {
      const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === tier.name.toLowerCase());
      if (role && !member.roles.cache.has(role.id)) {
        try {
          await member.roles.add(role, `Level up milestone: reached Level ${currentLevel}`);
          addedRoles.push(tier.name);
        } catch (err) {
          console.warn(`[Leveling] Failed to grant role ${tier.name} to ${member.user.tag}:`, err.message);
        }
      }
    }
  }
  return addedRoles;
}

/**
 * Sends the level up notification in AniPedia container style
 */
async function sendLevelUpNotification(guild, member, newLevel, sendContainer, channelOverride = null) {
  let targetChannel = channelOverride;
  if (!targetChannel) {
    if (LEVELING_TEST_MODE) {
      targetChannel = guild.channels.cache.get(TESTING_CHANNEL_ID);
    } else {
      targetChannel = guild.channels.cache.find(c => c.name === DEFAULT_ANNOUNCE_CHANNEL_NAME);
    }
  }

  const levelUpText = `**${member} reached XP level ${newLevel}**! 🎉`;

  if (targetChannel && typeof targetChannel.send === 'function') {
    if (typeof sendContainer === 'function') {
      await sendContainer(targetChannel, {
        description: `### 🌟 **Level Up!**\n${levelUpText}`,
        footer: `AniPedia Progression • Level ${newLevel}`
      }).catch(async () => {
        await targetChannel.send(levelUpText).catch(() => {});
      });
    } else {
      await targetChannel.send(levelUpText).catch(() => {});
    }
  }
}

/**
 * Processes message XP awards
 */
async function handleMessageXp(message, db, client, sendContainer) {
  if (!message || !message.guild || message.author.bot) return;

  const authorId = message.author.id;
  const channel = message.channel;
  const channelName = (channel.name || '').toLowerCase();

  // Test mode isolation: only test channel and Master
  if (LEVELING_TEST_MODE) {
    if (channel.id !== TESTING_CHANNEL_ID || authorId !== MASTER_USER_ID) {
      return;
    }
  }

  // Blacklist check
  if (NO_XP_CHANNELS.has(channelName)) return;

  // Always increment message count in cache
  const userData = await getUserLevelData(authorId, message.author.username, db);
  userData.messagesCount = (userData.messagesCount || 0) + 1;

  // Cooldown check for XP reward
  const now = Date.now();
  const lastXp = userXpCooldowns.get(authorId) || userData.lastXpTimestamp || 0;
  if (now - lastXp < MESSAGE_XP_COOLDOWN_MS) {
    // Only message count updated
    userLevelsCache.set(authorId, userData);
    return;
  }

  // Roll random XP
  const xpAwarded = Math.floor(Math.random() * (MAX_MESSAGE_XP - MIN_MESSAGE_XP + 1)) + MIN_MESSAGE_XP;
  userXpCooldowns.set(authorId, now);
  userData.lastXpTimestamp = now;
  userData.currentXp = (userData.currentXp || 0) + xpAwarded;
  userData.totalXp = (userData.totalXp || 0) + xpAwarded;

  // Level Up Check
  let xpRequired = getXpNeededForNextLevel(userData.level);
  let leveledUp = false;
  let oldLevel = userData.level;

  while (userData.currentXp >= xpRequired) {
    userData.currentXp -= xpRequired;
    userData.level += 1;
    leveledUp = true;
    xpRequired = getXpNeededForNextLevel(userData.level);
  }

  await saveUserLevelData(authorId, userData, db);

  if (leveledUp) {
    if (message.member) {
      await syncMemberLevelRoles(message.member, userData.level);
    }
    await sendLevelUpNotification(message.guild, message.member || message.author, userData.level, sendContainer, channel);
  }
}

/**
 * Master Command: <level [@user] [level]>
 * Directly increases or sets a user's level and triggers the level-up notification
 */
async function handleLevelCommand(message, client, db, sendContainer) {
  const authorId = message.author.id;
  if (authorId !== MASTER_USER_ID) {
    await sendContainer(message, `<@${authorId}> • Access Denied. Only Master <@${MASTER_USER_ID}> can adjust member levels.`);
    return;
  }

  const content = message.content.replace(/^<level\s*/i, '').trim();
  const mentionedMember = message.mentions.members.first() || message.member;
  const targetId = mentionedMember.id;
  const targetUsername = mentionedMember.user.username;

  // Parse if a specific level number was passed
  const cleanArgs = content.replace(new RegExp(`<@!?${targetId}>`, 'g'), '').trim();
  const numberMatch = cleanArgs.match(/\b\d+\b/);

  const userData = await getUserLevelData(targetId, targetUsername, db);
  let newLevel;

  if (numberMatch) {
    newLevel = parseInt(numberMatch[0], 10);
  } else {
    // Default: increase by 1
    newLevel = (userData.level || 1) + 1;
  }

  userData.level = Math.max(1, newLevel);
  userData.totalXp = getTotalXpForLevel(userData.level) + userData.currentXp;
  await saveUserLevelData(targetId, userData, db);

  // Sync roles
  await syncMemberLevelRoles(mentionedMember, userData.level);

  // Trigger announcement
  await sendLevelUpNotification(message.guild, mentionedMember, userData.level, sendContainer, message.channel);

  await sendContainer(message, {
    description: `✅ **Level Adjusted:** <@${targetId}> has been set to **Level ${userData.level}** (${userData.currentXp}/${getXpNeededForNextLevel(userData.level)} XP).`,
    footer: `AniPedia Level Master Command`
  });
}

/**
 * Calculates global rank position for a user
 */
async function getUserRankPosition(userId, db = null) {
  if (db) {
    try {
      const snap = await db.collection('user_levels')
        .orderBy('totalXp', 'desc')
        .limit(200)
        .get();

      let rank = 1;
      for (const doc of snap.docs) {
        if (doc.id === userId) return rank;
        rank++;
      }
    } catch (err) {}
  }

  // Fallback to in-memory cache
  const sorted = Array.from(userLevelsCache.values()).sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0));
  const idx = sorted.findIndex(u => u.userId === userId);
  return idx !== -1 ? idx + 1 : 1;
}

/**
 * Formats voice seconds to string "Xd Yh" or "Xh Ym"
 */
function formatVoiceTime(seconds = 0) {
  if (!seconds || seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Renders high-resolution Canvas Rank Card
 * Supports custom rank.png background or procedural dark glassmorphism container
 */
async function generateRankCard(member, levelData, rankPosition) {
  const width = 960;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const level = levelData.level || 1;
  const currentXp = levelData.currentXp || 0;
  const nextXp = getXpNeededForNextLevel(level);
  const progressPercent = Math.min(1.0, Math.max(0, currentXp / nextXp));
  const messagesCount = (levelData.messagesCount || 0).toLocaleString();
  const voiceTime = formatVoiceTime(levelData.voiceSeconds || 0);

  // Check if custom rank.png exists in project or user uploaded directory
  const customBgPaths = [
    path.join(process.cwd(), 'assets', 'rank.png'),
    path.join(__dirname, 'assets', 'rank.png'),
    path.join(process.cwd(), 'rank.png'),
    path.join(__dirname, 'rank.png'),
    'C:/Users/Pradeep/.gemini/antigravity/brain/ecdc0373-4ef7-4871-8390-9440773aa398/.user_uploaded/media_1795457327225_6d248697.png'
  ];
  let customBg = null;
  for (const p of customBgPaths) {
    if (fs.existsSync(p)) {
      try {
        customBg = await loadImage(p);
        // Auto-save to project directory if not already there
        const targetPath = path.join(process.cwd(), 'rank.png');
        if (p !== targetPath && !fs.existsSync(targetPath)) {
          fs.copyFileSync(p, targetPath);
        }
        break;
      } catch (e) {}
    }
  }

  const width = customBg ? customBg.width : 960;
  const height = customBg ? customBg.height : 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  if (customBg) {
    ctx.drawImage(customBg, 0, 0, width, height);
  } else {
    // Procedural AniPedia Container V2 dark glassmorphic background
    ctx.fillStyle = '#0e0e12';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 22);
    ctx.fill();

    // Subtle neon border
    ctx.strokeStyle = '#272730';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Ambient radial glow behind card
    const radial = ctx.createRadialGradient(width - 150, 60, 20, width - 150, 60, 250);
    radial.addColorStop(0, 'rgba(191, 90, 242, 0.18)');
    radial.addColorStop(1, 'rgba(14, 14, 18, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);

    // Subtle semi-transparent "ANIPEDIA" watermark in the center background
    ctx.save();
    ctx.font = 'bold 84px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ANIPEDIA', width / 2 + 60, height / 2 - 10);
    ctx.restore();
  }

  // Draw Avatar in the left circular HUD frame
  const avatarCenterX = width * 0.145;
  const avatarCenterY = height * 0.50;
  const avatarRadius = height * 0.285;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.clip();

  try {
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 512 });
    const avatarImg = await loadImage(avatarUrl);
    ctx.drawImage(avatarImg, avatarCenterX - avatarRadius, avatarCenterY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
  } catch (err) {
    ctx.fillStyle = '#1e1e24';
    ctx.fill();
  }
  ctx.restore();

  // Content Coordinates (Inside the right HUD container)
  const contentX = width * 0.285;

  // Display Name & Username
  const displayName = member.displayName || member.user.username;
  const username = `@${member.user.username}`;

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(height * 0.11)}px Arial, sans-serif`;
  ctx.fillText(displayName, contentX, height * 0.32);

  ctx.fillStyle = '#9ca3af';
  ctx.font = `${Math.round(height * 0.06)}px Arial, sans-serif`;
  ctx.fillText(username, contentX, height * 0.44);

  // Stats Badges (Voice Time & Messages)
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `bold ${Math.round(height * 0.055)}px Arial, sans-serif`;
  ctx.fillText(`Voice Time: ${voiceTime}`, contentX, height * 0.57);
  ctx.fillText(`Messages: ${messagesCount}`, contentX + width * 0.20, height * 0.57);

  // Rank Badge (Right Side of HUD)
  ctx.textAlign = 'right';
  ctx.fillStyle = '#38bdf8';
  ctx.font = `bold ${Math.round(height * 0.09)}px Arial, sans-serif`;
  ctx.fillText(`RANK #${rankPosition}`, width * 0.935, height * 0.32);

  // Level & XP Text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(height * 0.065)}px Arial, sans-serif`;
  ctx.fillText(`Level ${level} • ${currentXp.toLocaleString()} / ${nextXp.toLocaleString()} XP`, width * 0.935, height * 0.68);

  // XP Progress Bar Fill (inside the template's capsule track)
  const barX = width * 0.29;
  const barY = height * 0.745;
  const barWidth = width * 0.64;
  const barHeight = height * 0.105;
  const barRadius = barHeight / 2;

  // Draw glowing progress fill inside the track
  const fillWidth = Math.max(0, barWidth * progressPercent);
  if (fillWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(barX, barY, fillWidth, barHeight, barRadius);
    ctx.clip();

    const barGradient = ctx.createLinearGradient(barX, barY, barX + fillWidth, barY);
    barGradient.addColorStop(0, '#8b5cf6');
    barGradient.addColorStop(0.5, '#bf5af2');
    barGradient.addColorStop(1, '#38bdf8');
    ctx.fillStyle = barGradient;
    ctx.fill();
    ctx.restore();
  }

  // Percentage text centered inside the progress track
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(height * 0.055)}px Arial, sans-serif`;
  ctx.fillText(`${Math.round(progressPercent * 100)}%`, barX + barWidth / 2, barY + barHeight * 0.72);

  return canvas.toBuffer('image/png');
}

/**
 * Command: <rank [@user]> / /rank
 */
async function handleRankCommand(context, client, db, sendContainer) {
  const isInteraction = Boolean(context.isChatInputCommand || (context.reply && context.commandName));
  const channel = context.channel;
  const guild = context.guild;

  let targetMember = null;
  if (isInteraction) {
    targetMember = context.options.getMember('user') || context.member;
  } else {
    targetMember = context.mentions.members.first();
    if (!targetMember) {
      const cleanQuery = context.content.replace(/^<rank\s*/i, '').trim();
      if (cleanQuery) {
        targetMember = guild.members.cache.find(m =>
          m.user.username.toLowerCase() === cleanQuery.toLowerCase() ||
          (m.displayName && m.displayName.toLowerCase() === cleanQuery.toLowerCase()) ||
          m.id === cleanQuery
        );
      }
    }
    if (!targetMember) targetMember = context.member;
  }

  if (!isInteraction && channel && typeof channel.sendTyping === 'function') {
    channel.sendTyping().catch(() => {});
  }

  const levelData = await getUserLevelData(targetMember.id, targetMember.user.username, db);
  const rankPos = await getUserRankPosition(targetMember.id, db);

  const cardBuffer = await generateRankCard(targetMember, levelData, rankPos);
  const attachment = new AttachmentBuilder(cardBuffer, { name: `rank_${targetMember.id}.png` });

  if (isInteraction) {
    if (context.deferred && !context.replied) {
      await context.editReply({ files: [attachment] });
    } else {
      await context.reply({ files: [attachment] });
    }
  } else {
    await context.reply({ files: [attachment] });
  }
}

/**
 * Command: <leaderboard> / <xpleaderboard> / /leaderboard
 * Paginated XP Leaderboard in Container V2 styling
 */
async function handleXpLeaderboardCommand(context, client, db, sendContainer) {
  const isInteraction = Boolean(context.isChatInputCommand || (context.reply && context.commandName));
  const guild = context.guild;

  let topUsers = [];
  if (db) {
    try {
      const snap = await db.collection('user_levels')
        .orderBy('totalXp', 'desc')
        .limit(25)
        .get();
      topUsers = snap.docs.map(d => d.data());
    } catch (err) {
      console.error("[Leveling] Error querying leaderboard:", err.message);
    }
  }

  if (topUsers.length === 0) {
    topUsers = Array.from(userLevelsCache.values())
      .sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0))
      .slice(0, 25);
  }

  const medals = ['🥇', '🥈', '🥉'];
  let listStr = '';

  if (topUsers.length === 0) {
    listStr = 'No XP data recorded yet! Start chatting to earn XP.';
  } else {
    listStr = topUsers.map((u, i) => {
      const rankIcon = medals[i] || `\`#${i + 1}\``;
      const nextXp = getXpNeededForNextLevel(u.level || 1);
      return `${rankIcon} **<@${u.userId}>**\n↳ **Level ${u.level || 1}** • ${(u.currentXp || 0).toLocaleString()} / ${nextXp.toLocaleString()} XP (${(u.totalXp || 0).toLocaleString()} Total XP)`;
    }).join('\n\n');
  }

  const payload = {
    title: `🏆  ${guild?.name || 'AniPedia'} XP Leaderboard`,
    description: listStr,
    footer: `AniPedia XP Leaderboard • Top ${topUsers.length} Members`,
    timestamp: Date.now()
  };

  if (typeof sendContainer === 'function') {
    await sendContainer(context, payload);
  } else {
    const embed = new EmbedBuilder()
      .setColor(0xBF5AF2)
      .setTitle(payload.title)
      .setDescription(payload.description)
      .setFooter({ text: payload.footer })
      .setTimestamp();

    if (isInteraction) {
      if (context.deferred && !context.replied) {
        await context.editReply({ embeds: [embed] });
      } else {
        await context.reply({ embeds: [embed] });
      }
    } else {
      await context.reply({ embeds: [embed] });
    }
  }
}

/**
 * Bulk import helper to seed or restore levels from an array of member objects
 * [ { userId: '...', level: 71, currentXp: 13620, totalXp: ..., messagesCount: ... } ]
 */
async function importXpList(dataList, db = null) {
  if (!Array.isArray(dataList)) return { imported: 0, error: 'Invalid array format' };
  let count = 0;
  for (const entry of dataList) {
    if (!entry.userId) continue;
    const currentData = await getUserLevelData(entry.userId, entry.username || 'User', db);
    const updated = {
      ...currentData,
      ...entry,
      level: entry.level || currentData.level || 1,
      currentXp: entry.currentXp !== undefined ? entry.currentXp : currentData.currentXp,
      totalXp: entry.totalXp !== undefined ? entry.totalXp : getTotalXpForLevel(entry.level || 1) + (entry.currentXp || 0)
    };
    await saveUserLevelData(entry.userId, updated, db);
    count++;
  }
  return { imported: count };
}

module.exports = {
  handleMessageXp,
  handleLevelCommand,
  handleRankCommand,
  handleXpLeaderboardCommand,
  getUserLevelData,
  saveUserLevelData,
  importXpList,
  LEVELING_TEST_MODE,
  TESTING_CHANNEL_ID,
  MASTER_USER_ID
};
