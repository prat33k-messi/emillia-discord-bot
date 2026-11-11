/**
 * Fixed Stats Feature (Aura & IQ) with Decimal Precision & Gacha Rarity
 * - 95.1 - 100.0: Exactly 1 in 120 (0.833%)
 * - 90.1 - 95.0: Exactly 1 in 80 (1.250%)
 * - Decimal precision (e.g. 64.2%, 92.8%, 98.7%)
 * - Fix & Remove button controls with Firestore persistence
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

function buildContainerPayload(text, ephemeral = true) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  const flags = ephemeral ? (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) : MessageFlags.IsComponentsV2;
  return {
    components: [container],
    flags
  };
}

// In-memory caches for instant response without database latency
const fixedAuraCache = new Map();
const fixedIqCache = new Map();

/**
 * Total Weight = 120,000
 * - Transcendent (95.1 - 100.0): 1,000 / 120,000 = exactly 1 in 120 (0.833%)
 * - Divine (90.1 - 95.0):        1,500 / 120,000 = exactly 1 in 80  (1.250%)
 * - Supreme (80.1 - 90.0):       7,100 / 120,000 = 5.917%
 * - Ascendant (60.1 - 80.0):    18,000 / 120,000 = 15.000%
 * - Awakening (30.1 - 60.0):    50,400 / 120,000 = 42.000%
 * - Common (0.0 - 30.0):        42,000 / 120,000 = 35.000%
 * Sum = 120,000 (100.000%)
 */
const AURA_TIERS = [
  { min: 0.0,  max: 30.0,  weight: 42600, label: 'Common',      rarityMin: 35, rarityMax: 40 },
  { min: 30.1, max: 60.0,  weight: 45000, label: 'Awakening',   rarityMin: 41, rarityMax: 47 },
  { min: 60.1, max: 80.0,  weight: 10000, label: 'Ascendant',   rarityMin: 65, rarityMax: 75 },
  { min: 80.1, max: 90.0,  weight: 1800,  label: 'Supreme',     rarityMin: 81, rarityMax: 89 },
  { min: 90.1, max: 95.0,  weight: 400,   label: 'One Piece',   rarityMin: 91, rarityMax: 95 },
  { min: 95.1, max: 100.0, weight: 200,   label: 'Anirare Piece', rarityMin: 96, rarityMax: 100 }
];

function rollAuraPercent(fixedScore = null) {
  if (typeof fixedScore === 'number' && !isNaN(fixedScore)) {
    const fixedClamped = Math.round(Math.max(0, Math.min(100, fixedScore)));
    let matchingTier = AURA_TIERS.find(t => fixedClamped >= Math.floor(t.min) && fixedClamped <= Math.ceil(t.max)) || AURA_TIERS[0];
    return {
      percent: fixedClamped,
      rarity: `${fixedClamped}% (${matchingTier.label})`,
      isFixed: true
    };
  }

  const totalWeight = AURA_TIERS.reduce((acc, t) => acc + t.weight, 0);
  let randomVal = Math.random() * totalWeight;

  for (const tier of AURA_TIERS) {
    if (randomVal < tier.weight) {
      const raw = Math.random() * (tier.max - tier.min) + tier.min;
      const percent = Math.round(raw);
      const rarityText = `${percent}% (${tier.label})`;
      return { percent, rarity: rarityText, isFixed: false };
    }
    randomVal -= tier.weight;
  }

  const fallback = Math.round(Math.random() * 30);
  return { percent: fallback, rarity: `${fallback}% (Common)`, isFixed: false };
}

function buildAuraActionRow(authorId, score, isFixed) {
  const intScore = Math.round(score);
  if (isFixed) {
    const lockBtn = new ButtonBuilder()
      .setCustomId(`aura_status_${authorId}`)
      .setLabel(`Locked at ${intScore}%`)
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const removeBtn = new ButtonBuilder()
      .setCustomId(`aura_remove_${authorId}`)
      .setLabel('Remove / Roll Random')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(lockBtn, removeBtn);
  } else {
    const fixBtn = new ButtonBuilder()
      .setCustomId(`aura_fix_${authorId}_${intScore}`)
      .setLabel(`Fix Aura (${intScore}%)`)
      .setEmoji('📌')
      .setStyle(ButtonStyle.Success);

    return new ActionRowBuilder().addComponents(fixBtn);
  }
}

function buildIqActionRow(authorId, tierIndex, score, isFixed) {
  const intScore = Math.round(score);
  if (isFixed) {
    const lockBtn = new ButtonBuilder()
      .setCustomId(`iq_status_${authorId}`)
      .setLabel(`Locked at ${intScore}%`)
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const removeBtn = new ButtonBuilder()
      .setCustomId(`iq_remove_${authorId}`)
      .setLabel('Remove / Roll Random')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(lockBtn, removeBtn);
  } else {
    const fixBtn = new ButtonBuilder()
      .setCustomId(`iq_fix_${authorId}_${tierIndex}_${intScore}`)
      .setLabel(`Fix IQ (${intScore}%)`)
      .setEmoji('📌')
      .setStyle(ButtonStyle.Success);

    return new ActionRowBuilder().addComponents(fixBtn);
  }
}

async function loadUserFixedStats(db, userId) {
  if (!db || !userId) return { fixedAura: null, fixedIq: null };
  try {
    const doc = await db.collection('user_fixed_stats').doc(userId).get();
    if (doc.exists) {
      const data = doc.data();
      if (typeof data.fixedAura === 'number') fixedAuraCache.set(userId, data.fixedAura);
      if (data.fixedIq) fixedIqCache.set(userId, data.fixedIq);
      return data;
    }
  } catch (err) {
    console.error("Error loading fixed stats from DB:", err);
  }
  return { fixedAura: fixedAuraCache.get(userId) || null, fixedIq: fixedIqCache.get(userId) || null };
}

async function handleFixedStatsButton(interaction, db) {
  const customId = interaction.customId;
  const userId = interaction.user.id;

  if (customId.startsWith('aura_fix_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];
    const score = Math.round(parseFloat(parts[3]));

    if (userId !== targetUserId) {
      const msg = `<@${userId}> • You can't touch <@${targetUserId}>'s aura!`;
      await interaction.reply(buildContainerPayload(msg, false)).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    fixedAuraCache.set(userId, score);
    if (db) {
      await db.collection('user_fixed_stats').doc(userId).set({
        fixedAura: score,
        updatedAt: new Date()
      }, { merge: true }).catch(err => console.error("Error saving fixed aura:", err));
    }

    const updatedRow = buildAuraActionRow(userId, score, true);
    await interaction.update({ components: [updatedRow] }).catch(() => {});
    await interaction.followUp({ content: `📌 Your Aura has been permanently fixed at **${score}%**! Next time you run \`<aura\`, this score will always appear!`, ephemeral: true }).catch(() => {});
    return true;
  }

  if (customId.startsWith('aura_remove_')) {
    const targetUserId = customId.replace('aura_remove_', '');
    if (userId !== targetUserId) {
      const msg = `<@${userId}> • You can't touch <@${targetUserId}>'s aura!`;
      await interaction.reply(buildContainerPayload(msg, false)).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    fixedAuraCache.delete(userId);
    if (db) {
      await db.collection('user_fixed_stats').doc(userId).update({
        fixedAura: null
      }).catch(err => console.error("Error removing fixed aura:", err));
    }

    const disabledBtn = new ButtonBuilder()
      .setCustomId(`aura_removed_${userId}`)
      .setLabel('Fixed Aura Removed')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const updatedRow = new ActionRowBuilder().addComponents(disabledBtn);
    await interaction.update({ components: [updatedRow] }).catch(() => {});
    await interaction.followUp({ content: "🔄 Your fixed Aura has been removed! Next time you run `<aura`, you will roll random scores again!", ephemeral: true }).catch(() => {});
    return true;
  }

  if (customId.startsWith('iq_fix_')) {
    const parts = customId.split('_');
    const targetUserId = parts[2];
    const tierIndex = parseInt(parts[3], 10);
    const score = Math.round(parseFloat(parts[4]));

    if (userId !== targetUserId) {
      const msg = `<@${userId}> • You can't touch <@${targetUserId}>'s IQ!`;
      await interaction.reply(buildContainerPayload(msg, false)).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    const iqData = { tierIndex, score };
    fixedIqCache.set(userId, iqData);
    if (db) {
      await db.collection('user_fixed_stats').doc(userId).set({
        fixedIq: iqData,
        updatedAt: new Date()
      }, { merge: true }).catch(err => console.error("Error saving fixed iq:", err));
    }

    const updatedRow = buildIqActionRow(userId, tierIndex, score, true);
    await interaction.update({ components: [updatedRow] }).catch(() => {});
    await interaction.followUp({ content: `📌 Your IQ has been permanently fixed at **${score}%**! Next time you run \`<iq\`, this character and score will always appear!`, ephemeral: true }).catch(() => {});
    return true;
  }

  if (customId.startsWith('iq_remove_')) {
    const targetUserId = customId.replace('iq_remove_', '');
    if (userId !== targetUserId) {
      const msg = `<@${userId}> • You can't touch <@${targetUserId}>'s IQ!`;
      await interaction.reply(buildContainerPayload(msg, false)).catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    fixedIqCache.delete(userId);
    if (db) {
      await db.collection('user_fixed_stats').doc(userId).update({
        fixedIq: null
      }).catch(err => console.error("Error removing fixed iq:", err));
    }

    const disabledBtn = new ButtonBuilder()
      .setCustomId(`iq_removed_${userId}`)
      .setLabel('Fixed IQ Removed')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const updatedRow = new ActionRowBuilder().addComponents(disabledBtn);
    await interaction.update({ components: [updatedRow] }).catch(() => {});
    await interaction.followUp({ content: "🔄 Your fixed IQ has been removed! Next time you run `<iq`, you will roll random scores again!", ephemeral: true }).catch(() => {});
    return true;
  }

  return false;
}

async function resetAllFixedStats(db) {
  fixedAuraCache.clear();
  fixedIqCache.clear();

  if (db) {
    try {
      const snapshot = await db.collection('user_fixed_stats').get();
      if (!snapshot.empty) {
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`[FixedStats] Successfully wiped ${snapshot.size} records from Firestore.`);
      }
    } catch (err) {
      console.error("[FixedStats] Error wiping user_fixed_stats in Firestore:", err);
    }
  }
}

module.exports = {
  AURA_TIERS,
  rollAuraPercent,
  buildAuraActionRow,
  buildIqActionRow,
  loadUserFixedStats,
  handleFixedStatsButton,
  resetAllFixedStats,
  fixedAuraCache,
  fixedIqCache
};
