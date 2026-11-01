const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function createVerificationPanelPayload(guild) {
  const verifyEmbed = new EmbedBuilder()
    .setColor(0xBF5AF2)
    .setTitle('ANIPEDIA VERIFICATION GATEWAY')
    .setDescription(
      `Welcome to **AniPedia**! ⛩️🌸\n\n` +
      `To safeguard our sanctuary from automated bots, alternate accounts, and malicious raids, all newcomers must verify before accessing server channels.\n\n` +
      `**✦ Verification Directives:**\n` +
      `• Click the **Verify 🌸** button below.\n` +
      `• Your account will undergo an automated security & alt-risk assessment.\n` +
      `• Upon passing, you will instantly receive the **Member** role and unlock all channels.\n\n` +
      `*By verifying, you confirm that you will abide by all server rules and community guidelines.*`
    )
    .setFooter({ text: 'AniPedia Security Shield • Click below to verify' })
    .setTimestamp();

  const verifyBtn = new ButtonBuilder()
    .setCustomId('anipedia_verify_btn')
    .setLabel('Verify')
    .setEmoji('🌸')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(verifyBtn);

  return {
    embeds: [verifyEmbed],
    components: [row]
  };
}

async function handleVerificationButton(interaction, helpers = {}) {
  const { logToEmilliaLog } = helpers;
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
      content: "Mou! 🌸 Could not find the **Member** role in this server! Please notify server administrators. ❄️"
    }).catch(() => {});
    return;
  }

  if (member.roles.cache.has(memberRole.id)) {
    await interaction.editReply({
      content: "🌸 You are already verified as a **Member** in AniPedia! Enjoy exploring the server! ✨"
    }).catch(() => {});
    return;
  }

  const ageMs = Date.now() - user.createdTimestamp;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const isFlagged = ageDays < 3;
  const hasCustomAvatar = Boolean(user.avatar);

  if (isFlagged) {
    await interaction.editReply({
      content: `⚠️ **Security Notice • Verification Flagged**\n\nMou! Your Discord account was created less than **3 days** ago (<t:${Math.floor(user.createdTimestamp / 1000)}:R>).\n\nTo safeguard AniPedia sanctuary from unauthorized alts and raids, your account has been flagged for staff review in **#emillia-log**.\nA moderator will review and approve your account shortly! 🌸`
    }).catch(() => {});

    try {
      const logChannel = guild.channels.cache.find(ch => ch.name === 'emillia-log');
      if (logChannel) {
        const alertEmbed = new EmbedBuilder()
          .setColor(0xE74C3C)
          .setTitle('Security Alert • Alt Shield Flagged')
          .setDescription(
            `<@${user.id}> (\`${user.tag}\` - \`${user.id}\`) attempted to verify, but was **flagged by the Alt Shield**!\n\n` +
            `• **Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)\n` +
            `• **Account Age:** \`${ageDays.toFixed(1)} day(s)\` *(Requirement: >= 3 days)*\n` +
            `• **Avatar:** ${hasCustomAvatar ? 'Custom Avatar' : 'Default Discord Avatar'}\n` +
            `• **Flag Reason:** Account age < 3 days (Potential alt or throwaway account)\n\n` +
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

  try {
    await member.roles.add(memberRole, 'Passed AniPedia Verification Gateway');

    await interaction.editReply({
      content: `🌸 **Verification Successful!**\n\nWelcome to **AniPedia**, <@${user.id}>! You have been granted the **Member** role and all sanctuary channels are now unlocked for you. Have fun! ⛩️✨`
    }).catch(() => {});

    if (typeof logToEmilliaLog === 'function') {
      const dot = helpers.dot || '•';
      logToEmilliaLog(guild, 'verify', user.tag, user.id, 'Aiko Security System', 'Passed Verification Gateway', [
        { name: `${dot} Account Age`, value: `-# \`${ageDays.toFixed(1)} day(s)\``, inline: true },
        { name: `${dot} Role Granted`, value: `-# \`${memberRole.name}\``, inline: true }
      ]);
    }
  } catch (addErr) {
    console.error("Error granting Member role in verification:", addErr);
    if (addErr.code === 50013) {
      await interaction.editReply({
        content: "Mou! 🌸 I couldn't assign the **Member** role because my bot role ('Emillia') is placed below the 'Member' role in Discord Server Settings -> Roles! Please ask an administrator to drag my role higher up! ❄️"
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: "Mou! 🌸 An error occurred while assigning the role. Please ask a moderator for help! ❄️"
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
      content: "Mou! 🌸 Only server staff can approve flagged accounts! ❄️",
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
      await targetMember.send(`🌸 **Verification Approved!**\n\nA moderator in **${guild.name}** has approved your verification! The **Member** role has been granted and all sanctuary channels are now open! ⛩️✨`);
    } catch (e) {}

    if (typeof logToEmilliaLog === 'function') {
      const dot = helpers.dot || '•';
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
  handleStaffApprovalButton
};
