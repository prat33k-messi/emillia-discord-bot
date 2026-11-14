/**
 * Loyal Server Tag Auto-Role System for AniPedia
 * - Automatically assigns Loyal role (ID: 1571078604354363412) when member equips server tag
 * - Automatically revokes Loyal role when tag is removed
 * - Supports Discord Native Server/Clan Tags (e.g. [HAKI], primary_guild) & text tags
 * - Real-time sync on messageCreate, raw gateway packets, member/user updates
 * - Runs sync sweep on bot startup for all members
 * - Silent operation (no alert/log sent to #aiko-log as requested)
 */

const { User, GuildMember } = require('discord.js');

const LOYAL_ROLE_ID = '1571078604354363412';
const ANIPEDIA_GUILD_ID = '1517882821673357312';

// In-memory cache for user clan / server tag data (userId -> clan object)
const userClanCache = new Map();

// Monkey-patch discord.js User and GuildMember so Discord's native 'clan' / 'primary_guild'
// payload is not dropped by discord.js when parsing API/Gateway data
if (User && User.prototype && !User.prototype.__clanPatched) {
  User.prototype.__clanPatched = true;
  const originalUserPatch = User.prototype._patch;
  User.prototype._patch = function (data) {
    originalUserPatch.call(this, data);
    if (data.clan) this.clan = data.clan;
    if (data.primary_guild) {
      this.primaryGuild = data.primary_guild;
      this.clan = this.clan || data.primary_guild;
    }
  };
}

if (GuildMember && GuildMember.prototype && !GuildMember.prototype.__clanPatched) {
  GuildMember.prototype.__clanPatched = true;
  const originalMemberPatch = GuildMember.prototype._patch;
  GuildMember.prototype._patch = function (data) {
    originalMemberPatch.call(this, data);
    if (data.clan) this.clan = data.clan;
    if (data.primary_guild) {
      this.primaryGuild = data.primary_guild;
      this.clan = this.clan || data.primary_guild;
    }
    if (data.user) {
      if (data.user.clan && this.user) this.user.clan = data.user.clan;
      if (data.user.primary_guild && this.user) {
        this.user.primaryGuild = data.user.primary_guild;
        this.user.clan = this.user.clan || data.user.primary_guild;
      }
    }
  };
}

/**
 * Checks whether text contains the server tag (case-insensitive)
 * Avoids false positives like "anime", "biriyani", "maniac" for "ani"
 */
function matchesTextTag(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();

  // Full keywords
  if (lower.includes('haki') || lower.includes('anipedia') || lower.includes('.ani')) {
    return true;
  }

  // Standalone tag token for 'ani' (e.g. "[ani]", "| ani", "ani |", "User .ani", "#ani")
  if (/(?:^|[.\-_|\s\[(#])ani(?:$|[.\-_|\s\])#])/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a guild member currently possesses the server tag
 */
function hasServerTag(member, explicitClan = null) {
  if (!member || !member.user) return false;

  const guild = member.guild;

  // 1. Check Native Discord Server / Clan Tag (e.g. [HAKI])
  const clan = explicitClan ||
               userClanCache.get(member.id) ||
               userClanCache.get(member.user?.id) ||
               member.user?.clan ||
               member.user?.primaryGuild ||
               member.user?.primary_guild ||
               member.clan ||
               member.primaryGuild ||
               member.primary_guild;

  if (clan) {
    const idGuild = clan.identity_guild_id || clan.identityGuildId;
    if (idGuild && (idGuild === guild.id || idGuild === ANIPEDIA_GUILD_ID)) {
      return true;
    }
    const clanTag = (clan.tag || '').toLowerCase().trim();
    if (clanTag && (clanTag === 'haki' || clanTag.includes('haki') || clanTag === 'ani' || clanTag.includes('ani'))) {
      return true;
    }
  }

  // 2. Check Nickname & Display Names & Username
  const namesToCheck = [
    member.nickname || '',
    member.displayName || '',
    member.user.username || '',
    member.user.globalName || ''
  ];

  for (const name of namesToCheck) {
    if (matchesTextTag(name)) {
      return true;
    }
  }

  // 3. Check Custom Status if presence is available
  if (member.presence && member.presence.activities) {
    for (const act of member.presence.activities) {
      const state = act.state || '';
      if (matchesTextTag(state)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Syncs the Loyal role for a single member
 */
async function syncMemberLoyalRole(member, explicitClan = null) {
  if (!member || !member.guild || member.user?.bot) return;

  const guild = member.guild;
  let loyalRole = guild.roles.cache.get(LOYAL_ROLE_ID) ||
                  guild.roles.cache.find(r => r.name.toLowerCase() === 'loyal');

  if (!loyalRole) {
    const fetched = await guild.roles.fetch().catch(() => null);
    loyalRole = fetched?.get(LOYAL_ROLE_ID) || fetched?.find(r => r.name.toLowerCase() === 'loyal');
  }

  if (!loyalRole) return;

  const userHasTag = hasServerTag(member, explicitClan);
  const currentlyHasRole = member.roles.cache.has(loyalRole.id);

  if (userHasTag && !currentlyHasRole) {
    try {
      await member.roles.add(loyalRole, 'AniPedia Loyal Tag Auto-Assign');
      console.log(`[Loyal System] Auto-assigned Loyal role to ${member.user.tag} (${member.id})`);
    } catch (err) {
      console.error(`[Loyal System] Failed to assign Loyal role to ${member.user.tag}:`, err.message);
    }
  } else if (!userHasTag && currentlyHasRole) {
    try {
      await member.roles.remove(loyalRole, 'AniPedia Loyal Tag Auto-Revoke (tag removed)');
      console.log(`[Loyal System] Auto-revoked Loyal role from ${member.user.tag} (${member.id})`);
    } catch (err) {
      console.error(`[Loyal System] Failed to revoke Loyal role from ${member.user.tag}:`, err.message);
    }
  }
}

/**
 * Sweeps the entire guild on startup to sync all members
 */
async function sweepAllMembersLoyalRole(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      let loyalRole = guild.roles.cache.get(LOYAL_ROLE_ID) ||
                      guild.roles.cache.find(r => r.name.toLowerCase() === 'loyal');

      if (!loyalRole) {
        const fetchedRoles = await guild.roles.fetch().catch(() => null);
        loyalRole = fetchedRoles?.get(LOYAL_ROLE_ID) || fetchedRoles?.find(r => r.name.toLowerCase() === 'loyal');
      }

      if (!loyalRole) continue;

      console.log(`[Loyal System] Running startup sweep for guild "${guild.name}"...`);
      const members = await guild.members.fetch().catch(() => guild.members.cache);
      let assignedCount = 0;
      let revokedCount = 0;

      for (const member of members.values()) {
        if (member.user?.bot) continue;
        const userHasTag = hasServerTag(member);
        const currentlyHasRole = member.roles.cache.has(loyalRole.id);

        if (userHasTag && !currentlyHasRole) {
          await member.roles.add(loyalRole, 'AniPedia Loyal Tag Startup Sync').catch(() => {});
          assignedCount++;
        } else if (!userHasTag && currentlyHasRole) {
          await member.roles.remove(loyalRole, 'AniPedia Loyal Tag Startup Sync (No Tag)').catch(() => {});
          revokedCount++;
        }
      }

      console.log(`[Loyal System] Sweep complete for "${guild.name}": Assigned ${assignedCount}, Revoked ${revokedCount}.`);
    }
  } catch (err) {
    console.error('[Loyal System] Error in sweepAllMembersLoyalRole:', err);
  }
}

/**
 * Initializes the Loyal Tag listeners
 */
function initLoyalTagSystem(client) {
  // 1. Raw WebSocket Dispatch: Capture Discord's native clan / primary_guild from raw gateway payloads
  client.on('raw', async (packet) => {
    try {
      if (!packet || !packet.d) return;

      // Extract clan from author or user or member in raw packet
      let userId = null;
      let clanData = null;
      let guildId = packet.d.guild_id;

      if (packet.d.author && !packet.d.author.bot) {
        userId = packet.d.author.id;
        clanData = packet.d.author.clan || packet.d.author.primary_guild;
      } else if (packet.d.user && !packet.d.user.bot) {
        userId = packet.d.user.id;
        clanData = packet.d.user.clan || packet.d.user.primary_guild;
      }

      if (packet.d.member) {
        clanData = clanData || packet.d.member.clan || packet.d.member.primary_guild ||
                   packet.d.member.user?.clan || packet.d.member.user?.primary_guild;
        if (!userId && packet.d.member.user) {
          userId = packet.d.member.user.id;
        }
      }

      // Handle GUILD_MEMBERS_CHUNK to populate cache in bulk
      if (packet.t === 'GUILD_MEMBERS_CHUNK' && Array.isArray(packet.d.members)) {
        for (const m of packet.d.members) {
          const c = m.clan || m.primary_guild || m.user?.clan || m.user?.primary_guild;
          if (c && m.user?.id) {
            userClanCache.set(m.user.id, c);
          }
        }
      }

      if (userId && clanData) {
        userClanCache.set(userId, clanData);
      }

      // If a message was sent, immediately sync the author's Loyal role in that guild
      if (packet.t === 'MESSAGE_CREATE' && guildId && userId) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
          if (member) {
            await syncMemberLoyalRole(member, clanData);
          }
        }
      }
    } catch (e) {}
  });

  // 2. Real-time message listener
  client.on('messageCreate', async (message) => {
    try {
      if (message.author?.bot || !message.guild || !message.member) return;
      await syncMemberLoyalRole(message.member);
    } catch (e) {}
  });

  // 3. Member join listener
  client.on('guildMemberAdd', async (member) => {
    try {
      await syncMemberLoyalRole(member);
    } catch (e) {}
  });

  // 4. Member update (nickname, roles, etc.)
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      await syncMemberLoyalRole(newMember);
    } catch (e) {}
  });

  // 5. User update (global name, username, etc.)
  client.on('userUpdate', async (oldUser, newUser) => {
    try {
      for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(newUser.id) || await guild.members.fetch(newUser.id).catch(() => null);
        if (member) {
          await syncMemberLoyalRole(member);
        }
      }
    } catch (e) {}
  });

  // 6. Presence update (status change)
  client.on('presenceUpdate', async (oldPresence, newPresence) => {
    try {
      if (!newPresence || !newPresence.member) return;
      await syncMemberLoyalRole(newPresence.member);
    } catch (e) {}
  });

  console.log('[Loyal System] Loyal Tag Auto-Role System initialized successfully with Role ID:', LOYAL_ROLE_ID);
}

module.exports = {
  LOYAL_ROLE_ID,
  ANIPEDIA_GUILD_ID,
  userClanCache,
  hasServerTag,
  syncMemberLoyalRole,
  sweepAllMembersLoyalRole,
  initLoyalTagSystem
};
