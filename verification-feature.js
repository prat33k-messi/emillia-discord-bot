const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} = require('discord.js');

const CHALLENGE_ITEMS = [
  { name: 'Coffee Cup', emoji: '☕' },
  { name: 'Rice Ball', emoji: '🍙' },
  { name: 'Katana / Swords', emoji: '⚔️' },
  { name: 'Soccer Ball', emoji: '⚽' },
  { name: 'Shooting Star', emoji: '⭐' },
  { name: 'Flame / Fire', emoji: '🔥' },
  { name: 'Crescent Moon', emoji: '🌙' },
  { name: 'Magic Crystal', emoji: '💎' },
  { name: 'Four-Leaf Clover', emoji: '🍀' },
  { name: 'Butterfly', emoji: '🦋' }
];

function createVerificationPanelPayload(guild) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**ANIPEDIA VERIFICATION**\n` +
      `Welcome to **AniPedia**!\n` +
      `Click the button below to verify and unlock the channels.`
    )
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# AniPedia Security Shield • Click below to verify`)
  );

  const verifyBtn = new ButtonBuilder()
    .setCustomId('anipedia_verify_btn')
    .setLabel('Verify')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(verifyBtn);
  container.addActionRowComponents(row);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

function generateChallenge(userId) {
  const pool = [...CHALLENGE_ITEMS];
  const targetIndex = Math.floor(Math.random() * pool.length);
  const target = pool.splice(targetIndex, 1)[0];

  const shuffledPool = pool.sort(() => Math.random() - 0.5);
  const decoys = shuffledPool.slice(0, 3);

  const choices = [
    { item: target, isCorrect: true },
    { item: decoys[0], isCorrect: false },
    { item: decoys[1], isCorrect: false },
    { item: decoys[2], isCorrect: false }
  ].sort(() => Math.random() - 0.5);

  const buttons = choices.map((c, idx) => {
    const customId = c.isCorrect
      ? `anipedia_challenge_${userId}_correct_${target.name.replace(/\s+/g, '')}`
      : `anipedia_challenge_${userId}_wrong_${idx}`;

    return new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(c.item.name)
      .setEmoji(c.item.emoji)
      .setStyle(ButtonStyle.Secondary);
  });

  const row = new ActionRowBuilder().addComponents(buttons);

  const challengeEmbed = new EmbedBuilder()
    .setColor(0xBF5AF2)
    .setTitle('ANIPEDIA • VERIFICATION')
    .setDescription(
      `Welcome to AniPedia verification, <@${userId}>!\n` +
      `Click the button matching: **${target.name}** (${target.emoji})`
    );

  return {
    embeds: [challengeEmbed],
    components: [row]
  };
}

async function handleVerificationButton(interaction, helpers = {}) {
  const guild = interaction.guild;
  const user = interaction.user;
  const member = interaction.member;

  if (!guild || !member) return;

  await interaction.deferReply({ ephemeral: true }).catch(() => {});

  let memberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');
  if (!memberRole) {
    const fetched = await guild.roles.fetch().catch(() => null);
    memberRole = fetched?.find(r => r.name.toLowerCase() === 'member');
  }

  if (!memberRole) {
    await interaction.editReply({
      content: "Could not find the **Member** role in this server! Please notify server administrators."
    }).catch(() => {});
    return;
  }

  if (member.roles.cache.has(memberRole.id)) {
    await interaction.editReply({
      content: "You are already verified as a **Member** in AniPedia! Enjoy exploring the server!"
    }).catch(() => {});
    return;
  }

  const ageMs = Date.now() - user.createdTimestamp;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const isFlagged = ageDays < 10;
  const hasCustomAvatar = Boolean(user.avatar);

  if (isFlagged) {
    await interaction.editReply({
      content: `⚠️ **Security Notice • Verification Flagged**\n\nYour Discord account was created less than **10 days** ago (<t:${Math.floor(user.createdTimestamp / 1000)}:R>).\n\nTo safeguard AniPedia from unauthorized alts and raids, your account has been flagged for staff review in **#aiko-log**.\nA moderator will review and approve your account shortly.`
    }).catch(() => {});

    try {
      const logChannel = guild.channels.cache.find(ch => ch.name === 'aiko-log') || guild.channels.cache.find(ch => ch.name === 'emillia-log') || guild.channels.cache.find(ch => ch.name.includes('aiko-log'));
      if (logChannel) {
        const alertEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('Security Alert • Alt Shield Flagged')
          .setDescription(
            `<@${user.id}> (\`${user.tag}\` - \`${user.id}\`) attempted to verify, but was **flagged by the Alt Shield**!\n\n` +
            `• **Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)\n` +
            `• **Account Age:** \`${ageDays.toFixed(1)} day(s)\` *(Requirement: >= 10 days)*\n` +
            `• **Avatar:** ${hasCustomAvatar ? 'Custom Avatar' : 'Default Discord Avatar'}\n` +
            `• **Flag Reason:** Account age < 10 days (Potential alt or throwaway account)\n\n` +
            `If this is a legitimate user, click the button below to manually grant them the **Member** role.`
          )
          .setFooter({ text: 'AniPedia Security Shield' })
          .setTimestamp();

        const approveBtn = new ButtonBuilder()
          .setCustomId(`verify_staff_approve_${user.id}`)
          .setLabel('Approve & Verify Member')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(approveBtn);

        await logChannel.send({ embeds: [alertEmbed], components: [row] });
      }
    } catch (logErr) {
      console.error("Error logging alt shield flag:", logErr);
    }
    return;
  }

  const challengePayload = generateChallenge(user.id);
  await interaction.editReply(challengePayload).catch(() => {});
}

async function handleChallengeButton(interaction, helpers = {}) {
  const { logToEmilliaLog } = helpers;
  const customId = interaction.customId;
  const parts = customId.split('_');
  const targetUserId = parts[2];
  const outcome = parts[3];

  if (interaction.user.id !== targetUserId) {
    await interaction.reply({
      content: "This verification challenge belongs to someone else! Click the **Verify** button to start your own!",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  const guild = interaction.guild;
  const member = interaction.member;

  let memberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');
  if (!memberRole) {
    const fetched = await guild.roles.fetch().catch(() => null);
    memberRole = fetched?.find(r => r.name.toLowerCase() === 'member');
  }

  if (outcome !== 'correct') {
    const failEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('Verification Failed')
      .setDescription('Click **Verify** to try again!');

    await interaction.update({ embeds: [failEmbed], components: [] }).catch(() => {});
    return;
  }

  try {
    if (memberRole) {
      await member.roles.add(memberRole, 'Passed Human Verification Emoji Challenge');
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('Verified!')
      .setDescription(
        `Welcome to **AniPedia**, <@${interaction.user.id}>! You now have the **Member** role.`
      );

    await interaction.update({ embeds: [successEmbed], components: [] }).catch(() => {});

    if (typeof logToEmilliaLog === 'function') {
      const dot = '•';
      const ageMs = Date.now() - interaction.user.createdTimestamp;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      logToEmilliaLog(guild, 'verify', interaction.user.tag, interaction.user.id, 'Aiko Security System', 'Passed Human Challenge Check', [
        { name: `${dot} Account Age`, value: `-# \`${ageDays.toFixed(1)} day(s)\``, inline: true },
        { name: `${dot} Challenge Result`, value: `-# \`Passed Human Emoji Check\``, inline: true },
        { name: `${dot} Role Granted`, value: `-# \`${memberRole ? memberRole.name : 'Member'}\``, inline: true }
      ]);
    }
  } catch (err) {
    console.error("Error granting role after challenge:", err);
    if (err.code === 50013) {
      await interaction.update({
        content: "I couldn't assign the **Member** role because my bot role ('Emillia') is placed below the 'Member' role in Discord Server Settings -> Roles! Please ask an administrator to drag my role higher up.",
        embeds: [],
        components: []
      }).catch(() => {});
    } else {
      await interaction.update({
        content: "An error occurred while assigning the role. Please ask a moderator for help.",
        embeds: [],
        components: []
      }).catch(() => {});
    }
  }
}

async function handleStaffApprovalButton(interaction, helpers = {}) {
  const { getMemberTier, isWhitelistedUser, logToEmilliaLog } = helpers;

  const modTier = typeof getMemberTier === 'function' ? getMemberTier(interaction.member) : 0;
  const isWhitelisted = typeof isWhitelistedUser === 'function' ? isWhitelistedUser(interaction.user) : false;

  if (modTier < 1 && !isWhitelisted) {
    await interaction.reply({
      content: "Only server staff can approve flagged accounts.",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  const targetUserId = interaction.customId.replace('verify_staff_approve_', '');
  const guild = interaction.guild;

  let memberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');
  if (!memberRole) {
    const fetched = await guild.roles.fetch().catch(() => null);
    memberRole = fetched?.find(r => r.name.toLowerCase() === 'member');
  }

  if (!memberRole) {
    await interaction.reply({
      content: "Could not find the **Member** role in this server!",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  const targetMember = guild.members.cache.get(targetUserId) || await guild.members.fetch(targetUserId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({
      content: "This user is no longer in the server!",
      ephemeral: true
    }).catch(() => {});
    return;
  }

  try {
    await targetMember.roles.add(memberRole, `Manually approved by ${interaction.user.tag}`);

    const disabledBtn = new ButtonBuilder()
      .setCustomId(`approved_done_${targetUserId}`)
      .setLabel(`Approved by ${interaction.user.username}`)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const disabledRow = new ActionRowBuilder().addComponents(disabledBtn);

    await interaction.update({ components: [disabledRow] }).catch(() => {});

    try {
      await targetMember.send(`**Verification Approved!**\n\nA moderator in **${guild.name}** has approved your verification! The **Member** role has been granted and all server channels are now open.`);
    } catch (e) {}

    if (typeof logToEmilliaLog === 'function') {
      const dot = '•';
      logToEmilliaLog(guild, 'verify', targetMember.user.tag, targetMember.id, interaction.user.tag, 'Manually Approved via Staff Alert', [
        { name: `${dot} Role Granted`, value: `-# \`${memberRole.name}\``, inline: true }
      ]);
    }
  } catch (err) {
    console.error("Error in staff approval button:", err);
    await interaction.reply({ content: "Failed to assign role: " + err.message, ephemeral: true }).catch(() => {});
  }
}

module.exports = {
  createVerificationPanelPayload,
  handleVerificationButton,
  handleChallengeButton,
  handleStaffApprovalButton
};
