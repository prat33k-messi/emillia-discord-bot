const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const container = new ContainerBuilder();
console.log("ContainerBuilder methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(container)));

const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('test').setLabel('Verify').setStyle(ButtonStyle.Success)
);

try {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**ANIPEDIA VERIFICATION GATEWAY**\nWelcome to AniPedia! ⛩️🌸\nClick the button below to verify and unlock the channels."));
  console.log("Container text display added successfully!");
} catch (e) {
  console.error("Error adding text display:", e);
}

// Check if container can take action rows directly
if (typeof container.addActionRowComponents === 'function') {
  console.log("ContainerBuilder has addActionRowComponents!");
} else {
  console.log("ContainerBuilder does NOT have addActionRowComponents, rows go in message components: [container, row]");
}
