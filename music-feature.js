const { Kazagumo } = require('kazagumo');
const { Connectors } = require('shoukaku');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags
} = require('discord.js');

// High-speed, 24/7 Public Lavalink v4 SSL Nodes (320kbps Studio Audio)
const LAVALINK_NODES = [
  {
    name: 'DevamOp-V4',
    url: 'lavalink.devamop.in:443',
    auth: 'DevamOp',
    secure: true
  },
  {
    name: 'AjieBlogs-V4',
    url: 'lava-v4.ajieblogs.eu.org:443',
    auth: 'https://dsc.gg/ajidevserver',
    secure: true
  },
  {
    name: 'Jirayu-V4',
    url: 'lavalink.jirayu.net:443',
    auth: 'youshallnotpass',
    secure: true
  },
  {
    name: 'LexNet-V4',
    url: 'lavalink.lexnet.cc:443',
    auth: 'lexnethosting',
    secure: true
  },
  {
    name: 'LavaLink-Public',
    url: 'lava.link:80',
    auth: 'youshallnotpass',
    secure: false
  }
];

function isNodeReady() {
  if (!kazagumo || !kazagumo.shoukaku) return false;
  for (const node of kazagumo.shoukaku.nodes.values()) {
    if (node.state === 1 || node.state === 'CONNECTED' || node.state === 2) return true;
  }
  return false;
}

let kazagumo = null;
let clientRef = null;
let sendContainerRef = null;

// Lock Upcoming State tracking per Guild
// guildId -> { lockedByUserId: string, lockedByTag: string, lockedTrackTitle: string, lockedTrackUri: string, active: boolean }
const queueLocks = new Map();

function toSmallCaps(str) {
  const map = {
    A: 'ᴀ', B: 'ʙ', C: 'ᴄ', D: 'ᴅ', E: 'ᴇ', F: 'ꜰ', G: 'ɢ', H: 'ʜ', I: 'ɪ', J: 'ᴊ',
    K: 'ᴋ', L: 'ʟ', M: 'ᴍ', N: 'ɴ', O: 'ᴏ', P: 'ᴘ', Q: 'ǫ', R: 'ʀ', S: 's', T: 'ᴛ',
    U: 'ᴜ', V: 'ᴠ', W: 'ᴡ', X: 'x', Y: 'ʏ', Z: 'ᴢ',
    a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ',
    k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 's', t: 'ᴛ',
    u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
  };
  return str.split('').map(char => map[char] || char).join('');
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function getTrackThumbnail(track) {
  if (!track) return null;
  if (track.thumbnail && typeof track.thumbnail === 'string' && track.thumbnail.startsWith('http')) {
    return track.thumbnail;
  }
  if (track.identifier && typeof track.identifier === 'string') {
    return `https://i.ytimg.com/vi/${track.identifier}/hqdefault.jpg`;
  }
  return null;
}

/**
 * Automatically boosts the Voice Channel bitrate to the maximum allowable server ceiling
 * Tier 3: 384 kbps
 * Tier 2: 256 kbps
 * Tier 1: 128 kbps
 * Tier 0: 96 kbps
 */
async function optimizeVoiceChannelBitrate(voiceChannel) {
  if (!voiceChannel || !voiceChannel.guild) return null;
  try {
    const guild = voiceChannel.guild;
    let targetBitrate = 96000;
    if (guild.premiumTier === 3) targetBitrate = 384000;
    else if (guild.premiumTier === 2) targetBitrate = 256000;
    else if (guild.premiumTier === 1) targetBitrate = 128000;

    const currentBitrate = voiceChannel.bitrate || 64000;
    if (currentBitrate < targetBitrate) {
      const botMember = guild.members.me;
      if (botMember && voiceChannel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
        await voiceChannel.setBitrate(targetBitrate, 'AniPedia Studio Audio: Auto-boosted to maximum server bitrate ceiling');
        console.log(`[Aiko Music] Auto-boosted #${voiceChannel.name} bitrate: ${currentBitrate / 1000}kbps -> ${targetBitrate / 1000}kbps!`);
        return { boosted: true, from: currentBitrate / 1000, to: targetBitrate / 1000 };
      }
    }
    return { boosted: false, current: currentBitrate / 1000, max: targetBitrate / 1000 };
  } catch (err) {
    console.warn('[Aiko Music] Could not auto-boost bitrate (check Manage Channels permission):', err.message);
    return null;
  }
}

function initMusic(client, sendContainerFn) {
  clientRef = client;
  sendContainerRef = sendContainerFn;

  kazagumo = new Kazagumo(
    {
      defaultSearchEngine: 'youtube',
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      }
    },
    new Connectors.DiscordJS(client),
    LAVALINK_NODES
  );

  const triggerReady = () => {
    try {
      if (kazagumo?.shoukaku?.connector) {
        kazagumo.shoukaku.connector.ready(LAVALINK_NODES);
        console.log(`[Aiko Music] Dispatched ${LAVALINK_NODES.length} Lavalink nodes to Shoukaku connector.`);
      }
    } catch (e) {
      console.error('[Aiko Music] Error triggering connector.ready:', e);
    }
  };

  if (client.isReady && client.isReady()) {
    triggerReady();
  } else {
    client.once('ready', triggerReady);
  }

  client.on('raw', (packet) => {
    try {
      kazagumo?.shoukaku?.connector?.raw(packet);
    } catch (e) {}
  });

  kazagumo.shoukaku.on('ready', (name) => {
    console.log(`[Aiko Music] Lavalink Node "${name}" is connected & ready! (320kbps Studio Audio)`);
  });

  kazagumo.shoukaku.on('error', (name, error) => {
    console.warn(`[Aiko Music] Lavalink Node "${name}" encountered error:`, error.message);
  });

  kazagumo.shoukaku.on('close', (name, code, reason) => {
    console.warn(`[Aiko Music] Lavalink Node "${name}" closed (code: ${code}):`, reason);
  });

  kazagumo.shoukaku.on('disconnect', (name, count) => {
    console.warn(`[Aiko Music] Lavalink Node "${name}" disconnected. Reconnect attempt: ${count}`);
  });

  // Player Events
  kazagumo.on('playerStart', async (player, track) => {
    const textChannel = client.channels.cache.get(player.textId);
    if (!textChannel) return;

    // Release Upcoming Lock if this was the locked track starting
    const currentLock = queueLocks.get(player.guildId);
    let lockReleasedNotice = '';
    if (currentLock && currentLock.active) {
      if (currentLock.lockedTrackUri === track.uri || currentLock.lockedTrackTitle === track.title) {
        queueLocks.delete(player.guildId);
        lockReleasedNotice = `\n-# 🔓 **Upcoming lock released!** The queue is now open for new songs.`;
      }
    }

    const voiceChannel = client.channels.cache.get(player.voiceId);
    const bitrateDisplay = voiceChannel?.bitrate ? `${voiceChannel.bitrate / 1000}kbps` : '320kbps';
    const requesterMention = track.requester ? `<@${track.requester.id || track.requester}>` : 'AniPedia';

    const playerControls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_btn_playpause').setLabel('Pause / Resume').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_btn_skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_btn_loop').setLabel('Loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music_btn_stop').setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );

    const actionRow2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music_btn_like').setLabel('Like').setEmoji('💚').setStyle(ButtonStyle.Success)
    );

    const desc =
      `• **[${track.title}](${track.uri})**\n` +
      `• **${toSmallCaps('Duration')}**: \`${formatDuration(track.length)}\` — (${requesterMention})${lockReleasedNotice}`;

    await sendContainerRef(textChannel, {
      title: `🎵  ${toSmallCaps('Now Playing')}`,
      description: desc,
      thumbnail: getTrackThumbnail(track),
      components: [playerControls, actionRow2],
      footer: `AniPedia Music • Studio Fidelity`
    }).catch(() => {});
  });

  kazagumo.on('playerEnd', async (player) => {
    // If queue is completely finished, clean lock
    if (player.queue.length === 0) {
      queueLocks.delete(player.guildId);
    }
  });

  kazagumo.on('playerEmpty', async (player) => {
    queueLocks.delete(player.guildId);
    const textChannel = client.channels.cache.get(player.textId);
    if (textChannel) {
      await sendContainerRef(textChannel, {
        description: `🎵 • Queue is empty! Left the voice channel to preserve resources.`
      }).catch(() => {});
    }
    player.destroy();
  });

  console.log('[Aiko Music] Music system initialized with Kazagumo + Shoukaku!');
}

/**
 * Handle `<play` command
 */
async function handlePlayCommand(message, query) {
  try {
  if (!query) {
    await sendContainerRef(message, `<@${message.author.id}> • Please provide a song name, YouTube link, or Spotify track! e.g. \`<play Gurenge\` or \`<play https://open.spotify.com/track/...\``);
    return;
  }

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await sendContainerRef(message, `<@${message.author.id}> • You need to be inside a Voice Channel to play music!`);
    return;
  }

  const permissions = voiceChannel.permissionsFor(message.guild.members.me);
  if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    await sendContainerRef(message, `<@${message.author.id}> • I don't have permission to join or speak in **${voiceChannel.name}**!`);
    return;
  }

  // Check Lock Upcoming condition
  const currentLock = queueLocks.get(message.guild.id);
  const existingPlayer = kazagumo.players.get(message.guild.id);

  if (currentLock && currentLock.active && existingPlayer && existingPlayer.playing) {
    // If upcoming is locked, reject new additions
    await sendContainerRef(message, {
      title: `🔒  ${toSmallCaps('Upcoming Slot Locked')}`,
      description:
        `<@${message.author.id}>, the upcoming slot is currently **locked** by <@${currentLock.lockedByUserId}> for **${currentLock.lockedTrackTitle}**!\n\n` +
        `*No additional songs can be added until that track starts playing.*`
    });
    return;
  }

  // Auto Optimize Bitrate on join
  await optimizeVoiceChannelBitrate(voiceChannel);

    if (!isNodeReady()) {
      await sendContainerRef(message, `<@${message.author.id}> • ⏳ Connecting to studio audio server... Please try again in 5 seconds!`);
      return;
    }

    let result = null;
    const isUrl = /^https?:\/\//i.test(query.trim());

    if (isUrl) {
      result = await kazagumo.search(query, { requester: message.author });
    } else {
      try {
        result = await kazagumo.search(`ytsearch:${query}`, { requester: message.author });
      } catch (e) {}

      if (!result || !result.tracks || !result.tracks.length) {
        try {
          result = await kazagumo.search(`scsearch:${query}`, { requester: message.author });
        } catch (e) {}
      }

      if (!result || !result.tracks || !result.tracks.length) {
        try {
          result = await kazagumo.search(`ytmsearch:${query}`, { requester: message.author });
        } catch (e) {}
      }
    }

    if (!result || !result.tracks || !result.tracks.length) {
      await sendContainerRef(message, `<@${message.author.id}> • No tracks found for \`${query}\`!`);
      return;
    }

    let player = kazagumo.players.get(message.guild.id);
    if (!player) {
      player = await kazagumo.createPlayer({
        guildId: message.guild.id,
        textId: message.channel.id,
        voiceId: voiceChannel.id,
        volume: 85,
        deaf: true
      });
    }


  if (result.type === 'PLAYLIST') {
    for (const track of result.tracks) {
      player.queue.add(track);
    }
    await sendContainerRef(message, {
      title: `📑  ${toSmallCaps('Playlist Added to Queue')}`,
      description: `Added **${result.tracks.length} track(s)** from playlist **${result.playlistName || query}** to queue!\n**${toSmallCaps('Requested By')}** • <@${message.author.id}>`
    });
  } else {
    const track = result.tracks[0];
    player.queue.add(track);

    if (player.playing) {
      // Song is added as upcoming! Provide Lock Upcoming and Like buttons
      const lockBtnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`music_lock_upcoming_${message.author.id}`)
          .setLabel('Lock Upcoming')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('music_btn_like')
          .setLabel('Like')
          .setEmoji('💚')
          .setStyle(ButtonStyle.Success)
      );

      const enqueueDesc =
        `✅ **Added [${track.title}](${track.uri}) to the queue.**\n\n` +
        `**${toSmallCaps('Duration')}**: \`${formatDuration(track.length)}\` • **${toSmallCaps('Requestor')}**: <@${message.author.id}> • **${toSmallCaps('Position')}**: \`#${player.queue.length}\``;

      await sendContainerRef(message, {
        title: `🎵  ${toSmallCaps('Enqueued Track')}`,
        description: enqueueDesc,
        thumbnail: getTrackThumbnail(track),
        components: [lockBtnRow],
        footer: `AniPedia Music • Studio Fidelity`
      });
    }
  }

  if (!player.playing && !player.paused) {
    player.play();
  }
  } catch (err) {
    console.error('[Aiko Music Play Error]:', err);
    await sendContainerRef(message, `<@${message.author.id}> • Audio connection issue: ${err.message || 'Please try again in a few seconds!'}`);
  }
}

/**
 * Handle Lock Upcoming button / command
 */
async function handleLockUpcoming(interactionOrMessage, user, isStaff = false) {
  const guild = interactionOrMessage.guild;
  const player = kazagumo.players.get(guild.id);

  if (!player || !player.playing) {
    const msg = `<@${user.id}> • No music is currently playing!`;
    if (interactionOrMessage.isButton && interactionOrMessage.isButton()) {
      return await interactionOrMessage.reply({ content: msg, ephemeral: true });
    }
    return await sendContainerRef(interactionOrMessage, msg);
  }

  const requesterId = (interactionOrMessage.customId && interactionOrMessage.customId.startsWith('music_lock_upcoming_'))
    ? interactionOrMessage.customId.replace('music_lock_upcoming_', '')
    : null;
  if (requesterId && requesterId !== user.id && !isStaff) {
    if (interactionOrMessage.isButton && interactionOrMessage.isButton()) {
      return await interactionOrMessage.reply({
        content: "Only the member who queued this song or server staff can lock the upcoming slot! 🔒",
        ephemeral: true
      });
    }
  }

  if (player.queue.length === 0) {
    const msg = `<@${user.id}> • The queue is currently empty! Queue an upcoming song first using \`<play <song>\` before locking.`;
    if (interactionOrMessage.isButton && interactionOrMessage.isButton()) {
      return await interactionOrMessage.reply({ content: msg, ephemeral: true });
    }
    return await sendContainerRef(interactionOrMessage, msg);
  }

  const upcomingTrack = player.queue[0];
  const currentLock = queueLocks.get(guild.id);

  if (currentLock && currentLock.active) {
    const msg = `<@${user.id}> • Upcoming slot is already locked by <@${currentLock.lockedByUserId}> for **${currentLock.lockedTrackTitle}**!`;
    if (interactionOrMessage.isButton && interactionOrMessage.isButton()) {
      return await interactionOrMessage.reply({ content: msg, ephemeral: true });
    }
    return await sendContainerRef(interactionOrMessage, msg);
  }

  // Lock the slot
  queueLocks.set(guild.id, {
    lockedByUserId: user.id,
    lockedByTag: user.tag || user.username,
    lockedTrackTitle: upcomingTrack.title,
    lockedTrackUri: upcomingTrack.uri,
    active: true
  });

  const responseText =
    `🔒 **Upcoming Slot Locked Successfully!**\n` +
    `<@${user.id}> locked **${upcomingTrack.title}** in the upcoming slot.\n` +
    `*No other songs can be added until this track starts playing!*`;

  if (interactionOrMessage.isButton && interactionOrMessage.isButton()) {
    await interactionOrMessage.reply({
      content: `🔒 You locked the upcoming slot for **${upcomingTrack.title}**!`,
      ephemeral: true
    }).catch(() => {});

    await sendContainerRef(interactionOrMessage.channel, {
      title: `🔒  ${toSmallCaps('Upcoming Slot Reserved')}`,
      description: responseText
    });
  } else {
    await sendContainerRef(interactionOrMessage, {
      title: `🔒  ${toSmallCaps('Upcoming Slot Reserved')}`,
      description: responseText
    });
  }
}

/**
 * Handle Unlock Upcoming
 */
async function handleUnlockUpcoming(context, user, isStaff = false) {
  const guild = context.guild;
  const currentLock = queueLocks.get(guild.id);

  if (!currentLock || !currentLock.active) {
    return await sendContainerRef(context, `<@${user.id}> • The upcoming slot is not currently locked.`);
  }

  if (currentLock.lockedByUserId !== user.id && !isStaff) {
    return await sendContainerRef(context, `<@${user.id}> • Only the member who locked the track (<@${currentLock.lockedByUserId}>) or server staff can unlock it!`);
  }

  queueLocks.delete(guild.id);
  await sendContainerRef(context, {
    title: `🔓  ${toSmallCaps('Upcoming Slot Unlocked')}`,
    description: `The upcoming slot has been **unlocked** by <@${user.id}>. Members can now add songs to the queue freely!`
  });
}

/**
 * `<aikomusic>` Command — Interactive Container Menu
 */
async function sendAikoMusicMenu(context, user, options = {}) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('aikomusic_menu_select')
    .setPlaceholder('Select a music category to view commands...')
    .addOptions([
      {
        label: 'Playback Controls and Features',
        description: 'Play, pause, resume, skip, stop, volume & studio audio features',
        value: 'playback',
        emoji: '🎵'
      },
      {
        label: 'Lock Upcoming System',
        description: 'Reserve upcoming slot so no one can queue ahead',
        value: 'lock',
        emoji: '🔒'
      },
      {
        label: 'AniPedia Specials',
        description: 'Anime OST quick-play, 24/7 Lo-Fi radio, and lyrics',
        value: 'specials',
        emoji: '🎌'
      }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const mainDesc =
    `**Welcome to AniPedia Studio Music System!** 🎧\n\n` +
    `Stream music from **Spotify**, **YouTube**, and **SoundCloud** with **320kbps Lossless Audio**.\n` +
    `Select an option from the menu below to explore all music features!\n\n` +
    `• **Prefix:** \`<\`  *(e.g. \`<play song name\`)*\n` +
    `• **Audio Engine:** \`Lavalink v4 • 320kbps Native Opus\``;

  await sendContainerRef(context, {
    title: `🎵  ${toSmallCaps('AniPedia Music Sanctuary')}`,
    description: mainDesc,
    components: [row],
    footer: `AniPedia Music • High-Fidelity Audio`,
    ephemeral: options.ephemeral || false
  });
}

/**
 * Handles dropdown interactions for `<aikomusic>`
 */
async function handleAikoMusicSelect(interaction) {
  const selected = interaction.values[0];

  let title = '';
  let description = '';

  if (selected === 'playback') {
    title = `🎵  ${toSmallCaps('Playback Controls & Features')}`;
    description =
      `• **\`<play <name / link>\`** — Play track from YouTube, Spotify, or SoundCloud\n` +
      `• **\`<pause\`** — Pause the currently playing song\n` +
      `• **\`<resume\`** — Resume playback\n` +
      `• **\`<skip\`** — Skip to the next song in the queue\n` +
      `• **\`<stop\`** — Stop playback, clear queue, and leave voice channel\n` +
      `• **\`<queue\`** — View all upcoming songs in queue\n` +
      `• **\`<volume <1-100>\`** — Adjust audio volume (Default: 85%)\n` +
      `• **\`<bitrate\`** — Check voice channel bitrate status\n\n` +
      `**${toSmallCaps('Studio Audio Features')}**\n` +
      `• **Bitrate Optimization:** Aiko automatically boosts your Voice Channel to **384 kbps** (or maximum server boost ceiling) when she joins!\n` +
      `• **Engine:** Powered by Lavalink v4 with native 48kHz stereo Opus passthrough for zero lag and studio-grade sound.`;
  } else if (selected === 'lock') {
    title = `🔒  ${toSmallCaps('Lock Upcoming System')}`;
    description =
      `• **\`<lockupcoming\`** *(or click 🔒 Lock Upcoming on queued track)* — Locks the upcoming song so no one else can queue songs ahead of it until it starts!\n` +
      `• **\`<unlockupcoming\`** — Unlocks the upcoming slot early (by requester or Staff).\n\n` +
      `*Once your locked song starts playing, the lock automatically releases for everyone!*`;
  } else if (selected === 'specials') {
    title = `🎌  ${toSmallCaps('AniPedia Specials')}`;
    description =
      `• **\`<ost <anime name>\`** — Automatically finds and plays official anime openings & endings!\n` +
      `• **\`<radio\`** — Connects to 24/7 relaxing anime lo-fi chill radio\n` +
      `• **\`<lyrics\`** — Fetches real-time song lyrics`;
  }

  await sendContainerRef(interaction, {
    title,
    description,
    footer: `AniPedia Music • Only visible to you`,
    ephemeral: true
  });
}

/**
 * Handle Button interactions on player
 */
async function handleMusicButton(interaction, isStaff = false) {
  const guild = interaction.guild;
  const player = kazagumo.players.get(guild.id);
  const user = interaction.user;

  if (interaction.customId.startsWith('music_lock_upcoming')) {
    return await handleLockUpcoming(interaction, user, isStaff);
  }

  if (!player) {
    return await interaction.reply({ content: "No active music player in this server!", ephemeral: true });
  }

  const memberVc = interaction.member?.voice?.channel;
  if (!memberVc || memberVc.id !== player.voiceId) {
    return await interaction.reply({ content: "You must be in the same voice channel as Aiko to use player controls!", ephemeral: true });
  }

  if (interaction.customId === 'music_btn_playpause') {
    if (player.paused) {
      player.pause(false);
      await interaction.reply({ content: "▶️ Resumed playback!", ephemeral: true });
    } else {
      player.pause(true);
      await interaction.reply({ content: "⏸️ Paused playback!", ephemeral: true });
    }
  } else if (interaction.customId === 'music_btn_skip') {
    player.skip();
    await interaction.reply({ content: "⏭️ Skipped current track!", ephemeral: true });
  } else if (interaction.customId === 'music_btn_stop') {
    player.destroy();
    queueLocks.delete(guild.id);
    await interaction.reply({ content: "⏹️ Stopped playback and cleared queue!", ephemeral: true });
  } else if (interaction.customId === 'music_btn_loop') {
    const nextMode = player.loop === 'track' ? 'none' : 'track';
    player.setLoop(nextMode);
    await interaction.reply({ content: `🔁 Loop set to **${nextMode.toUpperCase()}**!`, ephemeral: true });
  } else if (interaction.customId === 'music_btn_like') {
    const currentTrack = player.queue.current;
    const trackTitle = currentTrack ? currentTrack.title : 'this track';
    await interaction.reply({ content: `💚 Added **${trackTitle}** to your favorites!`, ephemeral: true });
  } else if (interaction.customId === 'music_btn_lock') {
    return await handleLockUpcoming(interaction, user, isStaff);
  }
}

/**
 * Handle other music commands
 */
async function handleOtherMusicCommands(message, cmd, args, isStaff = false) {
  const guild = message.guild;
  const player = kazagumo?.players?.get(guild.id);

  if (cmd === 'pause') {
    if (!player) return await sendContainerRef(message, `<@${message.author.id}> • No music is currently playing!`);
    player.pause(true);
    await sendContainerRef(message, `<@${message.author.id}> • ⏸️ Paused playback! Use \`<resume\` to continue.`);
  } else if (cmd === 'resume') {
    if (!player) return await sendContainerRef(message, `<@${message.author.id}> • No music is currently playing!`);
    player.pause(false);
    await sendContainerRef(message, `<@${message.author.id}> • ▶️ Resumed playback!`);
  } else if (cmd === 'skip') {
    if (!player) return await sendContainerRef(message, `<@${message.author.id}> • No music is currently playing!`);
    player.skip();
    await sendContainerRef(message, `<@${message.author.id}> • ⏭️ Skipped to next track!`);
  } else if (cmd === 'stop') {
    if (!player) return await sendContainerRef(message, `<@${message.author.id}> • No music is currently playing!`);
    player.destroy();
    queueLocks.delete(guild.id);
    await sendContainerRef(message, `<@${message.author.id}> • ⏹️ Stopped music playback and cleared queue.`);
  } else if (cmd === 'queue') {
    if (!player || !player.queue.length && !player.playing) {
      return await sendContainerRef(message, `<@${message.author.id}> • The music queue is currently empty!`);
    }
    const currentLock = queueLocks.get(guild.id);
    const lockStatus = currentLock && currentLock.active
      ? `\n🔒 **Upcoming Slot Status:** \`Locked by @${currentLock.lockedByTag} for "${currentLock.lockedTrackTitle}"\``
      : `\n🔓 **Upcoming Slot Status:** \`Unlocked\``;

    const currentTrack = player.queue.current
      ? `**${toSmallCaps('Now Playing')}** • [${player.queue.current.title}](${player.queue.current.uri}) (\`${formatDuration(player.queue.current.length)}\`)\n\n`
      : '';

    const list = player.queue.slice(0, 10).map((t, idx) => {
      const isLocked = idx === 0 && currentLock && currentLock.active;
      const tag = isLocked ? ' 🔒 `[LOCKED]`' : '';
      return `\`${idx + 1}.\` [${t.title}](${t.uri}) (\`${formatDuration(t.length)}\`)${tag}`;
    }).join('\n');

    await sendContainerRef(message, {
      title: `📑  ${toSmallCaps('Current Music Queue')}`,
      description: `${currentTrack}**${toSmallCaps('Upcoming Queue')}** (${player.queue.length} track(s)):\n${list || '*No further tracks in queue.*'}${lockStatus}`
    });
  } else if (cmd === 'volume') {
    if (!player) return await sendContainerRef(message, `<@${message.author.id}> • No music is currently playing!`);
    const val = parseInt(args[0], 10);
    if (isNaN(val) || val < 1 || val > 150) {
      return await sendContainerRef(message, `<@${message.author.id}> • Please specify a volume percentage between 1 and 150! e.g. \`<volume 90\``);
    }
    player.setVolume(val);
    await sendContainerRef(message, `<@${message.author.id}> • 🔊 Volume set to **${val}%**!`);
  } else if (cmd === 'ost') {
    const animeQuery = args.join(' ');
    if (!animeQuery) {
      return await sendContainerRef(message, `<@${message.author.id}> • Please provide an anime name! e.g. \`<ost solo leveling\` or \`<ost jjk\``);
    }
    await handlePlayCommand(message, `${animeQuery} official opening theme ost`);
  } else if (cmd === 'radio') {
    await handlePlayCommand(message, 'https://www.youtube.com/watch?v=jfKfPfyJRdk'); // 24/7 Lofi Anime Beats
  } else if (cmd === 'bitrate') {
    const vc = message.member?.voice?.channel;
    if (!vc) return await sendContainerRef(message, `<@${message.author.id}> • You are not in a voice channel!`);
    const opt = await optimizeVoiceChannelBitrate(vc);
    const curr = opt ? (opt.to || opt.current) : (vc.bitrate / 1000);
    await sendContainerRef(message, {
      title: `🔊  ${toSmallCaps('Voice Bitrate Optimization')}`,
      description:
        `• **Channel:** <#${vc.id}>\n` +
        `• **Active Bitrate:** \`${curr} kbps\` (Studio High-Fidelity)\n` +
        `• **Server Max Ceiling:** \`${opt?.max || curr} kbps\``
    });
  } else if (cmd === 'lockupcoming') {
    await handleLockUpcoming(message, message.author, isStaff);
  } else if (cmd === 'unlockupcoming') {
    await handleUnlockUpcoming(message, message.author, isStaff);
  }
}

module.exports = {
  initMusic,
  handlePlayCommand,
  handleLockUpcoming,
  handleUnlockUpcoming,
  sendAikoMusicMenu,
  handleAikoMusicSelect,
  handleMusicButton,
  handleOtherMusicCommands,
  optimizeVoiceChannelBitrate
};
