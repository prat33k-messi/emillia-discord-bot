/**
 * Loyal Server Tag Auto-Role System for AniPedia
 * - Automatically assigns Loyal role (ID: 1571078604354363412) when member equips server tag
 * - Automatically revokes Loyal role when tag is removed
 * - Supports Discord Native Server/Clan Tags & username/nickname text tags
 * - Runs sync sweep on bot startup for all members
 * - Silent operation (no alert/log sent to #aiko-log as requested)
 */

const LOYAL_ROLE_ID = '1571078604354363412';

// Known server tag variants (case-insensitive)
const SERVER_TAG_KEYWORDS = ['haki', 'anipedia', '.ani', 'ani'];

/**
 * Checks whether a guild member currently possesses the server tag
 */
function hasServerTag(member) {
  if (!member || !member.user) return false;

  const guild = member.guild;

  // 1. Discord Native Server / Clan Tag (e.g. [HAKI])
  const clan = member.user.clan;
  if (clan) {
    if (clan.identity_guild_id && guild && clan.identity_guild_id === guild.id) {
      return true;
    }
    const clanTag = (clan.tag || '').toLowerCase();
    if (clanTag && SERVER_TAG_KEYWORDS.some(k => clanTag.includes(k.replace(/[^a-z0-9]/g, '')))) {
      return true;
    }
  }

  // 2. Check Nickname & Display Names & Username
  const namesToCheck = [
    member.nickname || '',
    member.displayName || '',
    member.user.username || '',
    member.user.globalName || ''
  ].map(n => n.toLowerCase());

  for (const name of namesToCheck) {
    if (SERVER_TAG_KEYWORDS.some(k => name.includes(k))) {
      return true;
    }
  }

  // 3. Check Custom Status if presence is available
  if (member.presence && member.presence.activities) {
    for (const act of member.presence.activities) {
      const state = (act.state || '').toLowerCase();
      if (state && SERVER_TAG_KEYWORDS.some(k => state.includes(k))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Syncs the Loyal role for a single member
 */
async function syncMemberLoyalRole(member) {
  if (!member || !member.guild || member.user?.bot) return;

  const guild = member.guild;
  let loyalRole = guild.roles.cache.get(LOYAL_ROLE_ID) ||
                  guild.roles.cache.find(r => r.name.toLowerCase() === 'loyal');

  if (!loyalRole) {
    const fetched = await guild.roles.fetch().catch(() => null);
    loyalRole = fetched?.get(LOYAL_ROLE_ID) || fetched?.find(r => r.name.toLowerCase() === 'loyal');
  }

  if (!loyalRole) {
    return;
  }

  const userHasTag = hasServerTag(member);
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
  client.on('guildMemberAdd', async (member) => {
    try {
      await syncMemberLoyalRole(member);
    } catch (e) {}
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      await syncMemberLoyalRole(newMember);
    } catch (e) {}
  });

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
  hasServerTag,
  syncMemberLoyalRole,
  sweepAllMembersLoyalRole,
  initLoyalTagSystem
};
