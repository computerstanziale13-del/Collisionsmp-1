require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const util = require("minecraft-server-util");
const express = require("express");

// --- SERVER EXPRESS (Per Render & UptimeRobot) ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🟢 Collision Main Bot è attivo e online!");
});

app.listen(PORT, () => {
  console.log(`Server Express in ascolto sulla porta ${PORT}`);
});

// --- BOT DISCORD PRINCIPALE ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const SERVER_IP = "mc.collisionsmp.it";
const SERVER_PORT = 25565;

// Configurazione Ruoli
const STAFF_ROLE_ID = "1541326834996875316";
const ADMIN_ROLE_IDS = [
  "1541343835316289537",
  "1541343833927843921",
  "1565803848130494674",
  "1541335752410005554",
];
const SANCTION_FORUM_ID = "1565815173485170778";

// Mappe di memoria
const mcRegistrations = new Map(); // DiscordID -> Nickname MC
const staffStrikes = new Map();
const startTime = Date.now();

// Funzione di controllo permessi per i comandi Staff Base
function hasStaffPermission(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.has(STAFF_ROLE_ID);
}

// Funzione di controllo permessi per i comandi Amministrativi/Rank
function hasAdminPermission(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return ADMIN_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

// Funzione helper per inviare i log nel forum sanzioni
async function logSanctionToForum(guild, title, fields, color) {
  try {
    const forumChannel = guild.channels.cache.get(SANCTION_FORUM_ID);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .addFields(fields)
      .setTimestamp();

    await forumChannel.threads.create({
      name: title,
      message: { embeds: [embed] },
    });
  } catch (error) {
    console.error("Errore durante l'invio del log nel Forum:", error);
  }
}

client.once("clientReady", async () => {
  console.log(`Bot Principale online come: ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("changelogs")
      .setDescription("Pubblica un changelog")
      .addStringOption((o) =>
        o.setName("titolo").setDescription("Titolo").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("testo").setDescription("Contenuto").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("annuncio")
      .setDescription("Invia un annuncio")
      .addStringOption((o) =>
        o.setName("messaggio").setDescription("Messaggio").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("status_network")
      .setDescription("Mostra lo stato del server Minecraft"),
    new SlashCommandBuilder()
      .setName("status_bot")
      .setDescription("Statistiche hardware del bot"),

    // Registrazione Minecraft
    new SlashCommandBuilder()
      .setName("registrati")
      .setDescription(
        "Associa il tuo account Discord al tuo nickname di Minecraft",
      )
      .addStringOption((o) =>
        o
          .setName("nickname")
          .setDescription("Il tuo nickname esatto in-game")
          .setRequired(true),
      ),

    // Gestione Staff & Rank
    new SlashCommandBuilder()
      .setName("aggiungi_staff")
      .setDescription("Assegna il ruolo Staff base ad un utente")
      .addUserOption((o) =>
        o
          .setName("utente")
          .setDescription("Utente da aggiungere allo staff")
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("rankup")
      .setDescription("Promuovi un membro dello staff")
      .addUserOption((o) =>
        o
          .setName("utente")
          .setDescription("Membro dello staff")
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName("vecchio_ruolo")
          .setDescription("Ruolo da rimuovere")
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName("nuovo_ruolo")
          .setDescription("Nuovo ruolo da assegnare")
          .setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("derank")
      .setDescription("Retrocedi un membro dello staff")
      .addUserOption((o) =>
        o
          .setName("utente")
          .setDescription("Membro dello staff")
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName("vecchio_ruolo")
          .setDescription("Ruolo da rimuovere")
          .setRequired(true),
      )
      .addRoleOption((o) =>
        o
          .setName("nuovo_ruolo")
          .setDescription("Nuovo ruolo di livello inferiore")
          .setRequired(true),
      ),

    // Moderazione (Discord & In-Game con Durata)
    new SlashCommandBuilder()
      .setName("ban_discord")
      .setDescription("Banna un utente da Discord")
      .addUserOption((o) =>
        o.setName("utente").setDescription("Utente").setRequired(true),
      )
      .addStringOption((o) => o.setName("motivo").setDescription("Motivo"))
      .addIntegerOption((o) =>
        o
          .setName("giorni")
          .setDescription(
            "Durata del ban in giorni (es: 7, lascia vuoto per permanente)",
          ),
      ),
    new SlashCommandBuilder()
      .setName("warn_discord")
      .setDescription("Warn un utente su Discord")
      .addUserOption((o) =>
        o.setName("utente").setDescription("Utente").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("motivo").setDescription("Motivo").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("ban_ingame")
      .setDescription("Registra un ban in-game di un giocatore")
      .addStringOption((o) =>
        o
          .setName("nickname")
          .setDescription("Nome del giocatore")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("motivo").setDescription("Motivo del ban").setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName("giorni")
          .setDescription(
            "Durata del ban in giorni (lascia vuoto per permanente)",
          ),
      ),
    new SlashCommandBuilder()
      .setName("warn_ingame")
      .setDescription("Registra un warn in-game di un giocatore")
      .addStringOption((o) =>
        o
          .setName("nickname")
          .setDescription("Nome del giocatore")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("motivo").setDescription("Motivo del warn").setRequired(true),
      ),
    new SlashCommandBuilder()
      .setName("strike_staff")
      .setDescription("Aggiunge uno Strike allo Staff")
      .addUserOption((o) =>
        o.setName("staffer").setDescription("Staffer").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("motivo").setDescription("Motivo").setRequired(true),
      ),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN_MAIN_BOT);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });
    console.log("Comandi Slash del Main Bot registrati con successo!");
  } catch (error) {
    console.error(error);
  }

  setInterval(updateMinecraftStatus, 60000);
  updateMinecraftStatus();
});

async function updateMinecraftStatus() {
  try {
    const response = await util.status(SERVER_IP, SERVER_PORT);
    client.user.setActivity(
      `${response.players.online}/${response.players.max} players`,
      { type: ActivityType.Watching },
    );
  } catch (error) {
    client.user.setActivity("Server Offline 🔴", {
      type: ActivityType.Watching,
    });
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, guild, member } = interaction;

  // --- UTILITY E MODERAZIONE STAFF ---
  if (commandName === "changelogs") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const embed = new EmbedBuilder()
      .setTitle(`⚙️ CHANGELOG: ${options.getString("titolo")}`)
      .setDescription(options.getString("testo"))
      .setColor(0x0099ff);
    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({
      content: "✅ Changelog pubblicato con successo.",
      ephemeral: true,
    });
  } else if (commandName === "annuncio") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const embed = new EmbedBuilder()
      .setTitle("📢 NUOVO ANNUNCIO 📢")
      .setDescription(options.getString("messaggio"))
      .setColor(0xffd700);
    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({
      content: "✅ Annuncio inviato con successo.",
      ephemeral: true,
    });
  } else if (commandName === "status_network") {
    await interaction.deferReply();
    try {
      const response = await util.status(SERVER_IP, SERVER_PORT);
      const embed = new EmbedBuilder()
        .setTitle("🌐 Stato CollisionSMP Network")
        .setColor(0x00ff00)
        .addFields(
          { name: "Status", value: "🟢 Online", inline: true },
          {
            name: "Giocatori",
            value: `\`${response.players.online}/${response.players.max}\``,
            inline: true,
          },
          {
            name: "Versione",
            value: `\`${response.version.name}\``,
            inline: false,
          },
        );
      await interaction.followUp({ embeds: [embed] });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setTitle("🌐 Stato CollisionSMP Network")
        .setColor(0xff0000)
        .addFields({
          name: "Status",
          value: "🔴 Offline / Manutenzione",
          inline: false,
        });
      await interaction.followUp({ embeds: [embed] });
    }
  } else if (commandName === "status_bot") {
    const up = Math.floor((Date.now() - startTime) / 1000);
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const embed = new EmbedBuilder()
      .setTitle("📊 Statistiche Main Bot")
      .setColor(0x800080)
      .addFields(
        {
          name: "Latenza",
          value: `\`${Math.round(client.ws.ping)} ms\``,
          inline: true,
        },
        {
          name: "Uptime",
          value: `\`${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\``,
          inline: true,
        },
        { name: "RAM", value: `\`${mem} MB\``, inline: true },
      );
    await interaction.reply({ embeds: [embed] });
  }

  // --- REGISTRAZIONE MINECRAFT ---
  else if (commandName === "registrati") {
    const nick = options.getString("nickname").trim();
    const lowerNick = nick.toLowerCase();

    for (const [id, savedNick] of mcRegistrations.entries()) {
      if (savedNick.toLowerCase() === lowerNick) {
        return interaction.reply({
          content: `❌ Il nickname Minecraft \`${nick}\` è già stato registrato da un altro utente!`,
          ephemeral: true,
        });
      }
    }

    mcRegistrations.set(interaction.user.id, nick);
    await interaction.reply({
      content: `✅ Account registrato con successo! Nickname Minecraft: \`${nick}\``,
      ephemeral: true,
    });
  }

  // --- GESTIONE STAFF (Ruoli Admin dedicati) ---
  else if (commandName === "aggiungi_staff") {
    if (!hasAdminPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi amministrativi necessari!",
        ephemeral: true,
      });
    const targetUser = options.getMember("utente");

    try {
      await targetUser.roles.add(STAFF_ROLE_ID);
      await interaction.reply({
        content: `✅ Ruolo Staff Base assegnato con successo a ${targetUser}!`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content:
          "❌ Errore nell'assegnazione del ruolo. Verifica la gerarchia dei ruoli.",
        ephemeral: true,
      });
    }
  } else if (commandName === "rankup") {
    if (!hasAdminPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi amministrativi necessari!",
        ephemeral: true,
      });
    const targetUser = options.getMember("utente");
    const oldRole = options.getRole("vecchio_ruolo");
    const newRole = options.getRole("nuovo_ruolo");

    try {
      await targetUser.roles.remove(oldRole);
      await targetUser.roles.add(newRole);
      await interaction.reply({
        content: `🎉 **RANKUP**: ${targetUser} promosso correttamente a ${newRole}!`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content:
          "❌ Impossibile aggiornare i ruoli. Verifica i permessi del bot.",
        ephemeral: true,
      });
    }
  } else if (commandName === "derank") {
    if (!hasAdminPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi amministrativi necessari!",
        ephemeral: true,
      });
    const targetUser = options.getMember("utente");
    const oldRole = options.getRole("vecchio_ruolo");
    const newRole = options.getRole("nuovo_ruolo");

    try {
      await targetUser.roles.remove(oldRole);
      await targetUser.roles.add(newRole);
      await interaction.reply({
        content: `📉 **DERANK**: ${targetUser} retrocesso a ${newRole}.`,
        ephemeral: true,
      });
    } catch (err) {
      await interaction.reply({
        content:
          "❌ Impossibile aggiornare i ruoli. Verifica i permessi del bot.",
        ephemeral: true,
      });
    }
  }

  // --- MODERAZIONE (SOLO LOG SU FORUM CON DURATA E ETICHETTA "GIOCATORE") ---
  else if (commandName === "ban_discord") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const user = options.getUser("utente");
    const reason = options.getString("motivo") || "Nessun motivo";
    const giorni = options.getInteger("giorni");
    const durataStr = giorni
      ? `${giorni} giorn${giorni === 1 ? "o" : "i"}`
      : "Permanente";

    try {
      await guild.members.ban(user, { reason });
      await interaction.reply({
        content: `✅ Ban eseguito e registrato nel forum.`,
        ephemeral: true,
      });

      await logSanctionToForum(
        guild,
        `🔨 [BAN DISCORD] ${user.tag}`,
        [
          {
            name: "Giocatore",
            value: `<@${user.id}> (\`${user.id}\`)`,
            inline: true,
          },
          { name: "Durata", value: `\`${durataStr}\``, inline: true },
          { name: "Motivo", value: reason, inline: false },
        ],
        0xff0000,
      );
    } catch (error) {
      await interaction.reply({
        content: `❌ Impossibile bannare l'utente. Verificare la gerarchia dei ruoli.`,
        ephemeral: true,
      });
    }
  } else if (commandName === "warn_discord") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const user = options.getUser("utente");
    const reason = options.getString("motivo");

    const embed = new EmbedBuilder()
      .setTitle("⚠️ Avvertimento Discord")
      .setColor(0xffa500)
      .addFields({ name: "Motivo", value: reason });
    try {
      await user.send({ embeds: [embed] });
    } catch (e) {}

    await interaction.reply({
      content: `✅ Warn inviato e registrato nel forum.`,
      ephemeral: true,
    });

    await logSanctionToForum(
      guild,
      `⚠️ [WARN DISCORD] ${user.tag}`,
      [
        {
          name: "Giocatore",
          value: `<@${user.id}> (\`${user.id}\`)`,
          inline: true,
        },
        { name: "Motivo", value: reason, inline: false },
      ],
      0xffa500,
    );
  } else if (commandName === "ban_ingame") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const nickname = options.getString("nickname");
    const motivo = options.getString("motivo");
    const giorni = options.getInteger("giorni");
    const durataStr = giorni
      ? `${giorni} giorn${giorni === 1 ? "o" : "i"}`
      : "Permanente";

    await interaction.reply({
      content: `✅ Ban in-game registrato nel forum.`,
      ephemeral: true,
    });

    await logSanctionToForum(
      guild,
      `🔨 [BAN IN-GAME] ${nickname}`,
      [
        { name: "Giocatore", value: `\`${nickname}\``, inline: true },
        { name: "Durata", value: `\`${durataStr}\``, inline: true },
        { name: "Motivo", value: motivo, inline: false },
      ],
      0xff0000,
    );
  } else if (commandName === "warn_ingame") {
    if (!hasStaffPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi necessari!",
        ephemeral: true,
      });
    const nickname = options.getString("nickname");
    const motivo = options.getString("motivo");

    await interaction.reply({
      content: `✅ Warn in-game registrato nel forum.`,
      ephemeral: true,
    });

    await logSanctionToForum(
      guild,
      `⚠️ [WARN IN-GAME] ${nickname}`,
      [
        { name: "Giocatore", value: `\`${nickname}\``, inline: true },
        { name: "Motivo", value: motivo, inline: false },
      ],
      0xffa500,
    );
  } else if (commandName === "strike_staff") {
    if (!hasAdminPermission(member))
      return interaction.reply({
        content: "❌ Non hai i permessi amministrativi necessari!",
        ephemeral: true,
      });
    const staffer = options.getUser("staffer");
    const motivo = options.getString("motivo");
    const count = (staffStrikes.get(staffer.id) || 0) + 1;
    staffStrikes.set(staffer.id, count);

    await interaction.reply({
      content: `✅ Strike registrato nel forum.`,
      ephemeral: true,
    });

    await logSanctionToForum(
      guild,
      `🚨 [STAFF STRIKE] ${staffer.tag}`,
      [
        { name: "Staffer", value: `<@${staffer.id}>`, inline: true },
        { name: "Totale Strike", value: `\`${count}/3\``, inline: true },
        { name: "Motivo", value: motivo, inline: false },
      ],
      0x800080,
    );
  }
});

client.login(process.env.TOKEN_MAIN_BOT);
