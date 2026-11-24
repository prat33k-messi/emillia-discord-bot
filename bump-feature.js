const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const DISBOARD_BOT_ID = '302050872383242240';
const BUMP_CHANNEL_ID = '1574824529270804531';
const SUPERVISOR_ROLE_ID = '1542798540676276224';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

let nextBumpTime = null;
let bumpTimeout = null;
let lastBumperId = '1013822181379162142'; // Initialized to Aerion who just bumped

async function saveBumpState(db, state) {
  if (!db) return;
  try {
    await db.collection('server_settings').doc('bump').set({
      nextBumpTime: state.nextBumpTime,
      lastBumperId: state.lastBumperId || null,
      updatedAt: new Date()
    }, { merge: true });
  } catch (err) {
    console.error('[Bump System] Error saving bump state to DB:', err.message);
  }
}

async function loadBumpState(db) {
  if (!db) return null;
  try {
    const doc = await db.collection('server_settings').doc('bump').get();
    if (doc.exists) {
      return doc.data();
    }
  } catch (err) {
    console.error('[Bump System] Error loading bump state from DB:', err.message);
  }
  return null;
}

function getKatanaSwordEmoji(guild, client) {
  const found = guild?.emojis?.cache?.find(e => e.name && e.name.toLowerCase() === 'ani_sword') ||
                client?.emojis?.cache?.find(e => e.name && e.name.toLowerCase() === 'ani_sword');
  return found ? found.toString() : '⚔️';
}

function scheduleBumpAlert(client, sendContainer, delayMs) {
  if (bumpTimeout) clearTimeout(bumpTimeout);

  bumpTimeout = setTimeout(async () => {
    try {
      const channel = client.channels.cache.get(BUMP_CHANNEL_ID) || await client.channels.fetch(BUMP_CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const sword = getKatanaSwordEmoji(channel.guild, client);
      const bumperMention = lastBumperId ? `<@${lastBumperId}>` : 'Nakama';
      const supervisorMention = `<@&${SUPERVISOR_ROLE_ID}>`;

      const katanaDescription =
        `# ${sword} **ANIPEDIA BUMP DIRECTIVE** ${sword}\n` +
        `> *The blade has rested for two hours. It is time to strike again and boost the sanctuary!*\n\n` +
        `│ ୨୧・**Previous Bumper:** ${bumperMention}\n` +
        `│ ୨୧・**Duty Assigned To:** ${supervisorMention} & Honorable Warriors\n` +
        `│ ୨୧・**Action Required:** Execute \`/bump\` below\n\n` +
        `🗡️ **Unsheathe your sword and run \`/bump\` now to elevate AniPedia to the top of Disboard!**`;

      const bumpEmbed = new EmbedBuilder()
        .setColor(0xBF5AF2)
        .setDescription(katanaDescription)
        .setFooter({ text: 'AniPedia Sanctuary • 2-Hour Katana Directive' })
        .setTimestamp();

      const bumpBtn = new ButtonBuilder()
        .setLabel('Disboard Server Page')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Link)
        .setURL('https://disboard.org/server/1517882821673357312');

      const row = new ActionRowBuilder().addComponents(bumpBtn);

      const pingContent = lastBumperId
        ? `${bumperMention} ${supervisorMention} ⚔️ **Time to bump AniPedia!**`
        : `${supervisorMention} ⚔️ **Time to bump AniPedia!**`;

      await sendContainer(channel, {
        content: pingContent,
        embeds: [bumpEmbed],
        components: [row]
      }).catch(async () => {
        await channel.send({
          content: pingContent,
          embeds: [bumpEmbed],
          components: [row]
        }).catch(() => {});
      });

      console.log(`[Bump System] 2-Hour Katana reminder dispatched. Pinged bumper ${lastBumperId} and Supervisor role.`);
    } catch (err) {
      console.error('[Bump System] Failed to send bump ready alert:', err);
    }
  }, Math.max(1000, delayMs));
}

async function initBumpFeature(client, db, sendContainer) {
  console.log('[Bump System] Initializing automated 2-hour Katana bump monitor for channel:', BUMP_CHANNEL_ID);
  const saved = await loadBumpState(db);

  if (saved && saved.nextBumpTime) {
    nextBumpTime = saved.nextBumpTime;
    if (saved.lastBumperId) lastBumperId = saved.lastBumperId;
    const now = Date.now();
    const remainingMs = nextBumpTime - now;

    if (remainingMs <= 0) {
      console.log('[Bump System] Stored bump cooldown expired. Firing Katana reminder...');
      scheduleBumpAlert(client, sendContainer, 3000);
    } else {
      console.log(`[Bump System] Resuming 2-hour bump timer. ${Math.round(remainingMs / 60000)} minutes remaining.`);
      scheduleBumpAlert(client, sendContainer, remainingMs);
    }
  } else {
    // Initial boot seed: Calculate remaining time from Aerion's 22:13 bump
    const estimatedNextBump = Date.now() + BUMP_COOLDOWN_MS;
    nextBumpTime = estimatedNextBump;
    scheduleBumpAlert(client, sendContainer, BUMP_COOLDOWN_MS);
  }
}

async function handleBumpMessage(message, client, db, sendContainer) {
  if (!message || !message.channel) return false;

  // Only listen to Disboard bot in the bump channel (or if Disboard responds anywhere)
  if (message.author.id !== DISBOARD_BOT_ID) return false;
  if (message.channel.id !== BUMP_CHANNEL_ID && !message.content.includes('bump') && !message.embeds?.[0]?.description?.includes('Bump')) return false;

  const embed = message.embeds?.[0];
  const desc = (embed?.description || '').toLowerCase();
  const title = (embed?.title || '').toLowerCase();
  const content = (message.content || '').toLowerCase();

  const isSuccess = desc.includes('bump done') ||
                    desc.includes('👍') ||
                    title.includes('bump done') ||
                    content.includes('bump done') ||
                    desc.includes('check it on disboard');

  const isCooldown = desc.includes('please wait another') ||
                     content.includes('please wait another') ||
                     desc.includes('cooldown');

  if (isSuccess) {
    const bumperUser = message.interaction?.user || message.mentions?.users?.first();
    const bumperId = bumperUser ? bumperUser.id : (lastBumperId || null);
    lastBumperId = bumperId;
    nextBumpTime = Date.now() + BUMP_COOLDOWN_MS;

    console.log(`[Bump System] Successful bump detected by ${bumperUser?.tag || bumperId || 'Member'}! Setting 2-hour Katana timer.`);
    await saveBumpState(db, { nextBumpTime, lastBumperId });
    scheduleBumpAlert(client, sendContainer, BUMP_COOLDOWN_MS);

    // Confirm in Katana style
    try {
      const sword = getKatanaSwordEmoji(message.guild, client);
      const bumperMention = bumperId ? `<@${bumperId}>` : 'Honorable Warrior';
      const thankText =
        `> ${sword} **Strike Confirmed!**\n` +
        `> Arigatou for bumping AniPedia, ${bumperMention}! 🌸\n` +
        `> The **2-hour cooldown timer** has been set. I will alert you and <@&${SUPERVISOR_ROLE_ID}> when the blade is ready to strike again! ⚔️`;

      const thankMsg = await message.channel.send({ content: thankText }).catch(() => null);
      if (thankMsg) {
        setTimeout(() => thankMsg.delete().catch(() => {}), 15000);
      }
    } catch (e) {}

    return true;
  }

  if (isCooldown) {
    // Try to extract timestamp or minutes from Disboard's cooldown response
    const timestampMatch = (embed?.description || message.content).match(/<t:(\d+):[RtfTF]>/);
    let remainingMs = BUMP_COOLDOWN_MS;

    if (timestampMatch && timestampMatch[1]) {
      const targetUnixMs = parseInt(timestampMatch[1], 10) * 1000;
      remainingMs = Math.max(5000, targetUnixMs - Date.now());
      nextBumpTime = targetUnixMs;
    } else {
      const minMatch = (embed?.description || message.content).match(/(\d+)\s*minute/i);
      if (minMatch && minMatch[1]) {
        const mins = parseInt(minMatch[1], 10);
        remainingMs = mins * 60 * 1000;
        nextBumpTime = Date.now() + remainingMs;
      }
    }

    console.log(`[Bump System] Cooldown message detected. Adjusting Katana timer to ${Math.round(remainingMs / 60000)} minutes.`);
    await saveBumpState(db, { nextBumpTime, lastBumperId });
    scheduleBumpAlert(client, sendContainer, remainingMs);
    return true;
  }

  return false;
}

async function handleBumpCheckCommand(message, sendContainer) {
  const now = Date.now();
  const sword = getKatanaSwordEmoji(message.guild, message.client);
  const supervisorMention = `<@&${SUPERVISOR_ROLE_ID}>`;

  if (nextBumpTime && nextBumpTime > now) {
    const unix = Math.floor(nextBumpTime / 1000);
    const bumperMention = lastBumperId ? `<@${lastBumperId}>` : 'None';
    await sendContainer(
      message,
      `<@${message.author.id}> • ${sword} **Katana Bump Status**\n` +
      `│ ୨୧・**Previous Bumper:** ${bumperMention}\n` +
      `│ ୨୧・**Assigned Duty:** ${supervisorMention}\n` +
      `│ ୨୧・**Next Strike:** Ready <t:${unix}:R> (<t:${unix}:t>) in <#${BUMP_CHANNEL_ID}>!`
    );
  } else {
    await sendContainer(
      message,
      `<@${message.author.id}> • 🗡️ **The blade is ready to strike right now!** Head over to <#${BUMP_CHANNEL_ID}> and type \`/bump\`! ${supervisorMention}`
    );
  }
}

module.exports = {
  BUMP_CHANNEL_ID,
  SUPERVISOR_ROLE_ID,
  initBumpFeature,
  handleBumpMessage,
  handleBumpCheckCommand
};
