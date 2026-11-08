/**
 * AniPedia Invite Tracker & Alt-Chain Investigation System
 * - Real-time invite tracking and cache synchronization
 * - Firestore persistence of inviter <-> invited user relations
 * - Automatic detection of who invited banned users & who they brought into the server
 * - Automatic revocation of active invite links created by banned users
 */

const { EmbedBuilder } = require('discord.js');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const guildInvitesCache = new Map(); // guildId -> Map<code, { code, uses, inviterId, inviterTag }>

function toSmallCaps(text) {
  const map = {
    A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ғ', G: 'ɢ', H: 'ʜ', I: 'ɪ', J: 'ᴊ',
    K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ', S: 's', T: 'ᴛ',
    U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ',
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ғ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
    k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ',
    u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
  };
  return String(text).split('').map(char => map[char] || char).join('');
}

async function cacheGuildInvites(guild) {
  if (!guild || !guild.invites) return;
  try {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;
    const inviteMap = new Map();
    invites.forEach(inv => {
      inviteMap.set(inv.code, {
        code: inv.code,
        uses: inv.uses || 0,
        inviterId: inv.inviter?.id || null,
        inviterTag: inv.inviter?.tag || inv.inviter?.username || null
      });
    });
    guildInvitesCache.set(guild.id, inviteMap);
  } catch (err) {
    console.error(`Error caching invites for guild ${guild.name}:`, err);
  }
}

async function initInviteTracker(client) {
  for (const guild of client.guilds.cache.values()) {
    await cacheGuildInvites(guild);
  }
  console.log(`[InviteTracker] Initialized invite cache for ${client.guilds.cache.size} guild(s).`);

  client.on('inviteCreate', async (invite) => {
    try {
      const cached = guildInvitesCache.get(invite.guild.id) || new Map();
      cached.set(invite.code, {
        code: invite.code,
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id || null,
        inviterTag: invite.inviter?.tag || invite.inviter?.username || null
      });
      guildInvitesCache.set(invite.guild.id, cached);
    } catch (e) {}
  });

  client.on('inviteDelete', async (invite) => {
    try {
      const cached = guildInvitesCache.get(invite.guild.id);
      if (cached) {
        cached.delete(invite.code);
      }
    } catch (e) {}
  });
}

async function trackMemberJoin(member, db) {
  if (!member || !member.guild) return null;
  const guild = member.guild;

  try {
    const newInvites = await guild.invites.fetch().catch(() => null);
    const cached = guildInvitesCache.get(guild.id) || new Map();
    let usedInvite = null;

    if (newInvites) {
      for (const [code, inv] of newInvites) {
        const prev = cached.get(code);
        if (prev && inv.uses > prev.uses) {
          usedInvite = inv;
          break;
        }
      }

      // Update in-memory cache
      const updatedMap = new Map();
      newInvites.forEach(inv => {
        updatedMap.set(inv.code, {
          code: inv.code,
          uses: inv.uses || 0,
          inviterId: inv.inviter?.id || null,
          inviterTag: inv.inviter?.tag || inv.inviter?.username || null
        });
      });
      guildInvitesCache.set(guild.id, updatedMap);
    }

    let inviterData = null;
    if (usedInvite && usedInvite.inviter) {
      inviterData = {
        inviterId: usedInvite.inviter.id,
        inviterTag: usedInvite.inviter.tag || usedInvite.inviter.username,
        inviteCode: usedInvite.code,
        uses: usedInvite.uses
      };
    } else {
      // Check for vanity URL if guild has one
      if (guild.vanityURLCode) {
        inviterData = {
          inviterId: 'VANITY_URL',
          inviterTag: 'Discord Vanity URL',
          inviteCode: guild.vanityURLCode,
          uses: 0
        };
      }
    }

    if (db && inviterData) {
      await db.collection('member_invites').doc(member.id).set({
        userId: member.id,
        userTag: member.user.tag,
        inviterId: inviterData.inviterId,
        inviterTag: inviterData.inviterTag,
        inviteCode: inviterData.inviteCode,
        joinedAt: FieldValue.serverTimestamp()
      }, { merge: true }).catch(err => console.error("Error saving member invite to Firestore:", err));
    }

    // Send log to #invite-log if it exists
    const inviteLogChannel = guild.channels.cache.find(ch => ch.name === 'invite-log');
    if (inviteLogChannel && inviterData) {
      const inviterDisplay = inviterData.inviterId === 'VANITY_URL' ? 'Vanity URL' : `<@${inviterData.inviterId}> (\`${inviterData.inviterTag}\`)`;
      const joinLogEmbed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle(`${toSmallCaps('Member Joined • Invite Tracked')}`)
        .setDescription(
          `**${toSmallCaps('Member')}:** <@${member.id}> \`(${member.user.tag})\`\n` +
          `**${toSmallCaps('Invited By')}:** ${inviterDisplay}\n` +
          `**${toSmallCaps('Invite Code')}:** \`${inviterData.inviteCode}\`${inviterData.uses ? ` • \`${inviterData.uses} total uses\`` : ''}`
        )
        .setFooter({ text: toSmallCaps('AniPedia Security Shield') })
        .setTimestamp();
      await inviteLogChannel.send({ embeds: [joinLogEmbed] }).catch(() => {});
    }

    return inviterData;
  } catch (err) {
    console.error("Error tracking member invite on join:", err);
    return null;
  }
}

async function checkAndRevokeUserInvites(guild, userId) {
  if (!guild || !guild.invites || !userId) return { count: 0, revokedCodes: [] };
  try {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return { count: 0, revokedCodes: [] };

    const userInvites = invites.filter(inv => inv.inviter && inv.inviter.id === userId);
    const revokedCodes = [];

    for (const [code, inv] of userInvites) {
      await inv.delete('Revoking invite created by banned or investigated user').catch(() => {});
      revokedCodes.push(code);
    }

    // Refresh cache
    await cacheGuildInvites(guild);

    return {
      count: revokedCodes.length,
      revokedCodes
    };
  } catch (err) {
    console.error(`Error revoking invites for user ${userId}:`, err);
    return { count: 0, revokedCodes: [] };
  }
}

async function getInviteReportForUser(guild, db, userId) {
  const result = {
    userId,
    invitedBy: null,
    invitedUsers: [],
    activeInvites: []
  };

  // 1. Check current server invites created by this user
  if (guild && guild.invites) {
    try {
      const allInvites = await guild.invites.fetch().catch(() => null);
      if (allInvites) {
        allInvites.forEach(inv => {
          if (inv.inviter && inv.inviter.id === userId) {
            result.activeInvites.push({
              code: inv.code,
              uses: inv.uses || 0,
              maxUses: inv.maxUses || 0,
              channelName: inv.channel?.name || 'Unknown',
              createdTimestamp: inv.createdTimestamp
            });
          }
        });
      }
    } catch (e) {}
  }

  // 2. Query Firestore for who invited this user, and who this user invited
  if (db) {
    try {
      const myInviteDoc = await db.collection('member_invites').doc(userId).get().catch(() => null);
      if (myInviteDoc && myInviteDoc.exists) {
        result.invitedBy = myInviteDoc.data();
      }

      const invitedByMeSnapshot = await db.collection('member_invites').where('inviterId', '==', userId).get().catch(() => null);
      if (invitedByMeSnapshot && !invitedByMeSnapshot.empty) {
        invitedByMeSnapshot.forEach(doc => {
          const data = doc.data();
          const memberInGuild = guild?.members?.cache?.get(data.userId);
          result.invitedUsers.push({
            userId: data.userId,
            userTag: data.userTag || 'Unknown',
            inviteCode: data.inviteCode || 'N/A',
            joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate() : null,
            isStillInServer: Boolean(memberInGuild)
          });
        });
      }
    } catch (err) {
      console.error("Error querying Firestore for invite report:", err);
    }
  }

  return result;
}

function buildInviteReportEmbed(reportData, targetTag = 'User') {
  const embed = new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`${toSmallCaps('Alt-Chain & Invite Audit Report')}`)
    .setFooter({ text: toSmallCaps('AniPedia Security Shield') })
    .setTimestamp();

  // Field 1: Target
  embed.addFields({
    name: `• ${toSmallCaps('Investigated User')}`,
    value: `<@${reportData.userId}> \`(${targetTag} - ${reportData.userId})\``,
    inline: false
  });

  // Field 2: Who invited them
  let invitedByText = '`No invite record found (Joined prior to tracker or via Vanity)`';
  if (reportData.invitedBy) {
    const inviterId = reportData.invitedBy.inviterId;
    const inviterTag = reportData.invitedBy.inviterTag || 'Unknown';
    const code = reportData.invitedBy.inviteCode || 'Unknown';
    if (inviterId === 'VANITY_URL') {
      invitedByText = `• **Vanity URL** (\`${code}\`)`;
    } else {
      invitedByText = `<@${inviterId}> (\`${inviterTag}\` - \`${inviterId}\`)\n• **Code Used:** \`${code}\``;
    }
  }
  embed.addFields({
    name: `• ${toSmallCaps('Invited By')}`,
    value: invitedByText,
    inline: false
  });

  const totalLinkUses = reportData.activeInvites.reduce((sum, inv) => sum + (inv.uses || 0), 0);

  // Field 3: Active Invites created by this user on the server
  let activeInvitesText = '`None currently active`';
  if (reportData.activeInvites.length > 0) {
    const lines = reportData.activeInvites.map(inv =>
      `• \`discord.gg/${inv.code}\` — **${inv.uses}** use(s) (Channel: #${inv.channelName})`
    );
    activeInvitesText = `**Total Uses Across Links:** \`${totalLinkUses} uses\`\n` + lines.join('\n');
  }
  embed.addFields({
    name: `• ${toSmallCaps('Active Server Invites Created')}`,
    value: activeInvitesText,
    inline: false
  });

  // Field 4: Members who joined using this user's links (Last 5 with User ID & Name)
  const sortedInvited = [...reportData.invitedUsers].sort((a, b) => {
    const timeA = a.joinedAt ? a.joinedAt.getTime() : 0;
    const timeB = b.joinedAt ? b.joinedAt.getTime() : 0;
    return timeB - timeA;
  });
  const last5 = sortedInvited.slice(0, 5);

  let invitedUsersText = '`No members joined through their links`';
  if (reportData.invitedUsers.length > 0) {
    const listStr = last5.map((u, idx) => {
      const statusBadge = u.isStillInServer ? '`In Server` 🟢' : '`Left/Banned` 🔴';
      const timeStr = u.joinedAt ? `<t:${Math.floor(u.joinedAt.getTime() / 1000)}:R>` : '';
      return `${idx + 1}. <@${u.userId}> (\`${u.userTag}\` — ID: \`${u.userId}\`) ${statusBadge} ${timeStr}`;
    }).join('\n');

    invitedUsersText = `**Total Logged Joins:** \`${reportData.invitedUsers.length}\`\n` +
      (reportData.invitedUsers.length > 5 ? `*Showing last 5 joined members:*\n` : '') +
      listStr;
  } else if (totalLinkUses > 0) {
    invitedUsersText = `**Historical Link Uses:** \`${totalLinkUses} uses\` *(Discord link counter)*\n` +
      `*No members logged yet since live tracker started. Anyone joining from now on will be recorded here with User ID and Name.*`;
  }

  embed.addFields({
    name: `• ${toSmallCaps(`Members Invited (${reportData.invitedUsers.length > 0 ? reportData.invitedUsers.length : totalLinkUses})`)}`,
    value: invitedUsersText.length > 1024 ? invitedUsersText.slice(0, 1020) + '...' : invitedUsersText,
    inline: false
  });

  return embed;
}

module.exports = {
  guildInvitesCache,
  initInviteTracker,
  trackMemberJoin,
  checkAndRevokeUserInvites,
  getInviteReportForUser,
  buildInviteReportEmbed
};
