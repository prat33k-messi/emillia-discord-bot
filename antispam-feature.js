/**
 * Anti-Spam Feature Module for AniPedia
 * Light-weight, non-harsh spam protection
 */

// Channels & Categories exempt from anti-spam
const EXEMPT_CHANNEL_IDS = new Set([
  '1522170324475449344',
  '1560934265624076308',
  '1564694091986641106'
]);

const EXEMPT_CATEGORY_IDS = new Set([
  '1518193783399776407'
]);

// Rolling history for duplicate messages: userId -> Array<{ content: string, timestamp: number }>
const userMessageHistory = new Map();

// Cooldown to prevent spamming warnings if multiple messages are deleted at once: userId -> timestamp
const userWarningCooldown = new Map();

/**
 * Checks if a message triggers anti-spam rules.
 * Returns true if handled (message deleted & warned), false otherwise.
 */
async function handleAntiSpam(message, helpers = {}) {
  const { getMemberTier, isWhitelistedUser } = helpers;

  if (!message || !message.guild || !message.channel || !message.author) return false;
  if (message.author.bot) return false;

  // 1. Check exemptions (Whitelisted, Staff/Mods)
  if (typeof isWhitelistedUser === 'function' && isWhitelistedUser(message.author)) return false;
  if (typeof getMemberTier === 'function' && message.member && getMemberTier(message.member) >= 1) return false;

  // 2. Check channel exemptions
  if (EXEMPT_CHANNEL_IDS.has(message.channel.id)) return false;

  // 3. Check category exemptions
  if (message.channel.parentId && EXEMPT_CATEGORY_IDS.has(message.channel.parentId)) return false;

  const content = message.content || '';
  const now = Date.now();
  let isSpam = false;
  let reason = '';

  // Rule A: Big text exceeding 6 lines
  const lines = content.split(/\r\n|\r|\n/);
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  if (nonEmptyLines.length > 8) {
    isSpam = true;
    reason = 'exceeding 6 lines';
  }

  // Rule B: Ping multiple people (more than 5 mentions)
  if (!isSpam && message.mentions && message.mentions.users) {
    const userMentions = message.mentions.users.filter(u => !u.bot && u.id !== message.author.id);
    // Filter out staff/mods so pinging mods is NEVER flagged as spam
    const nonStaffMentions = userMentions.filter(u => {
      const member = message.guild.members.cache.get(u.id);
      if (!member) return true;
      if (typeof isWhitelistedUser === 'function' && isWhitelistedUser(member)) return false;
      if (typeof getMemberTier === 'function' && getMemberTier(member) >= 1) return false;
      return true;
    });

    if (nonStaffMentions.size > 8) {
      isSpam = true;
      reason = 'pinging more than 5 users';
    }

    // Rule C: Pinging staff/moderators is fully allowed (no mod ping restrictions)
    /* Rule C removed: members can freely ping mods/staff without message deletion
    if (false) {
      let modMentionCount = 0;
      for (const [userId, user] of userMentions) {
        const member = message.guild.members.cache.get(userId);
        if (member && getMemberTier(member) >= 1) {
          modMentionCount++;
          if (modMentionCount > 1) {
            isSpam = true;
            reason = 'pinging multiple moderators';
            break;
          }
        }
      }
    } */
  }

  // Rule D: Repeated words / duplicate messages
  if (!isSpam && content.trim().length > 0) {
    const normalized = content.trim().toLowerCase();

    // Check single message containing repeating same word 6+ times (e.g. "hi hi hi hi hi hi")
    const words = normalized.split(/\s+/);
    if (words.length >= 6) {
      let maxConsecutive = 1;
      let curConsecutive = 1;
      for (let i = 1; i < words.length; i++) {
        if (words[i] === words[i - 1]) {
          curConsecutive++;
          if (curConsecutive > maxConsecutive) maxConsecutive = curConsecutive;
        } else {
          curConsecutive = 1;
        }
      }
      if (maxConsecutive >= 6) {
        isSpam = true;
        reason = 'repeated words in message';
      }
    }

    // Check rapid duplicate messages across multiple sends (e.g. sending "hi" 3-4 times in a row)
    if (!isSpam) {
      const history = userMessageHistory.get(message.author.id) || [];
      // Retain only messages from last 5 seconds
      const recent = history.filter(item => (now - item.timestamp) < 5000);

      // Count identical messages in recent window
      const duplicateCount = recent.filter(item => item.content === normalized).length;
      if (duplicateCount >= 4) {
        // 4th identical message within 8 seconds triggers spam
        isSpam = true;
        reason = 'rapid repeated messages';
      }

      recent.push({ content: normalized, timestamp: now });
      userMessageHistory.set(message.author.id, recent);
    }
  }

  if (isSpam) {
    // Delete the offending message
    await message.delete().catch(() => {});

    // Lite warning (with 4-second cooldown per user to prevent warning floods)
    const lastWarn = userWarningCooldown.get(message.author.id) || 0;
    if (now - lastWarn > 4000) {
      userWarningCooldown.set(message.author.id, now);
      try {
        const notice = await message.channel.send(`<@${message.author.id}> don't spam words/ping people`);
        if (notice) {
          setTimeout(() => {
            notice.delete().catch(() => {});
          }, 5000);
        }
      } catch (err) {
        console.error("Anti-spam notice error:", err);
      }
    }

    return true;
  }

  return false;
}

module.exports = {
  handleAntiSpam,
  EXEMPT_CHANNEL_IDS,
  EXEMPT_CATEGORY_IDS
};
