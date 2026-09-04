const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    PermissionFlagsBits 
} = require('discord.js');

// --- RAILWAY DEĞİŞKENLERİ ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // Botun Application ID'si
const WAITLIST_ROLE_ID = process.env.WAITLIST_ROLE_ID || "1545489606244302899";
const BOOSTER_ROLE_ID = process.env.BOOSTER_ROLE_ID || "1530296291152760905";
const TESTER_ROLE_ID = process.env.TESTER_ROLE_ID || "1530296291152760905";

const MAX_QUEUE_CAPACITY = 20;
const NORMAL_COOLDOWN = 5 * 24 * 60 * 60 * 1000; // 5 Gün (ms)
const BOOSTER_COOLDOWN = 2 * 24 * 60 * 60 * 1000; // 2 Gün (ms)

// Hafıza (State)
const queueData = {
    isOpen: false,
    activeTesters: new Set(),
    queue: [] // User ID array
};

const cooldowns = new Map(); // userId -> expiration Timestamp

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- EMBED OLUŞTURUCU ---
function createQueueEmbed(guild) {
    const isOpen = queueData.isOpen;
    const queueCount = queueData.queue.length;
    const percentage = Math.floor((queueCount / MAX_QUEUE_CAPACITY) * 100);

    const filledBlocks = Math.floor((queueCount / MAX_QUEUE_CAPACITY) * 10);
    const progressBar = "█".repeat(filledBlocks) + "▒".repeat(10 - filledBlocks);

    const color = isOpen ? 0x2ECC71 : 0xE74C3C;
    const statusStr = isOpen ? "🟢 AÇIK" : "🔴 KAPALI";

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: "www.trtier.com", iconURL: guild?.iconURL() || undefined })
        .setTitle("🛡️ Smp Test Sırası")
        .addFields(
            {
                name: "🗡️ Sıra Durumu",
                value: `\`\`\`\n┌─── ℹ️ Durum Bilgisi ───┐\n│ Durum: ${statusStr}\n│ Doluluk: [${progressBar}] ${queueCount}/${MAX_QUEUE_CAPACITY} (${percentage}%)\n│ Sıra: ${queueCount} / ${MAX_QUEUE_CAPACITY}\n└──────────────────────────┘\n\`\`\``,
                inline: false
            },
            {
                name: `🏆 Aktif Testerlar (${queueData.activeTesters.size})`,
                value: queueData.activeTesters.size > 0 
                    ? Array.from(queueData.activeTesters).map(id => `<@${id}>`).join("\n")
                    : "`Henüz aktif tester yok`",
                inline: false
            }
        );

    let queueListStr = "`Sırada kimse yok - İlk sen ol!`";
    if (queueData.queue.length > 0) {
        queueListStr = queueData.queue.map((userId, index) => {
            const member = guild.members.cache.get(userId);
            const isBooster = member && member.roles.cache.has(BOOSTER_ROLE_ID);
            const boosterIcon = isBooster ? "⭐" : "";
            const num = (index + 1).toString().padStart(2, '0');
            return `\`${num}.\` <@${userId}> ${boosterIcon}`;
        }).join("\n");
    }

    embed.addFields({
        name: `👥 Sıradaki Oyuncular (${queueCount} Kişi)\n📋 Sıra Listesi`,
        value: queueListStr,
        inline: false
    });

    embed.setFooter({ text: "⭐ = Booster • 🎫 = Ticket Açık • Smp Waitlist System" });
    return embed;
}

// --- BUTON BİLEŞENLERİ ---
function getMainWaitlistButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('main_smp_waitlist_btn')
            .setLabel('SMP Waitlist Al')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚔️'),
        new ButtonBuilder()
            .setCustomId('main_cooldown_check_btn')
            .setLabel('Cooldown Kontrol')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏰')
    );
}

function getQueueButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_queue_join')
            .setLabel('Katıl')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId('btn_queue_leave')
            .setLabel('Ayrıl')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('➖'),
        new ButtonBuilder()
            .setCustomId('btn_queue_kit_leave')
            .setLabel('Kitten Ayrıl')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🚫'),
        new ButtonBuilder()
            .setCustomId('btn_queue_tester_panel')
            .setLabel('Tester Paneli')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🏆')
    );
}

function getTesterPanelButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tp_toggle')
            .setLabel('Sırayı Aç / Kapat')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('tp_next')
            .setLabel('Sıradan Oyuncu Çağır')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('tp_clear')
            .setLabel('Sırayı Temizle')
            .setStyle(ButtonStyle.Danger)
        );
}

// --- SLASH COMMANDS DEREGISTER/REGISTER ---
const commands = [
    new SlashCommandBuilder()
        .setName('waitlist')
        .setDescription('Waitlist yönetim komutları')
        .addSubcommand(sub =>
            sub.setName('ac')
               .setDescription('Test sırasını açar (Sadece Testerlar)'))
        .addSubcommand(sub =>
            sub.setName('kapat')
               .setDescription('Test sırasını kapatır (Sadece Testerlar)')),
    new SlashCommandBuilder()
        .setName('setup_waitlist')
        .setDescription('SMP Waitlist Al mesajını gönderir')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('sira_mesaj')
        .setDescription('Canlı test sırası mesajını gönderir')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// --- BOT EVENTS ---
client.once('ready', async () => {
    console.log(`${client.user.tag} Node.js ile aktif!`);

    // Slash Komutlarını Kaydetme
    if (CLIENT_ID && TOKEN) {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        try {
            console.log('Slash komutları yükleniyor...');
            await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
            console.log('Slash komutları yüklendi!');
        } catch (error) {
            console.error('Slash komut yükleme hatası:', error);
        }
    }
});

// --- COMMAND INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName, options, member } = interaction;

        // /waitlist ac & /waitlist kapat
        if (commandName === 'waitlist') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) {
                return interaction.reply({ content: "❌ Bu komutu sadece **Tester** yetkilileri kullanabilir!", ephemeral: true });
            }

            const subcommand = options.getSubcommand();
            if (subcommand === 'ac') {
                queueData.isOpen = true;
                queueData.activeTesters.add(interaction.user.id);
                await interaction.reply({ content: "🟢 **Test sırası açıldı!**", ephemeral: true });
            } else if (subcommand === 'kapat') {
                queueData.isOpen = false;
                queueData.activeTesters.delete(interaction.user.id);
                await interaction.reply({ content: "🔴 **Test sırası kapatıldı!**", ephemeral: true });
            }
            return;
        }

        // Setup Komutları
        if (commandName === 'setup_waitlist') {
            const embed = new EmbedBuilder()
                .setTitle("✨ Türkiye Minecraft SMP Waitlist")
                .setDescription("Aşağıdaki **SMP Waitlist Al** butonuna basarak sıraya katılma rolü alabilirsiniz.\n\n⭐ **Booster kullanıcılar** daha kısa cooldown süresine ve sıra önceliğine sahiptir.")
                .setColor(0x3498DB);

            await interaction.channel.send({ embeds: [embed], components: [getMainWaitlistButtons()] });
            return interaction.reply({ content: "✅ Waitlist mesajı oluşturuldu.", ephemeral: true });
        }

        if (commandName === 'sira_mesaj') {
            await interaction.channel.send({ 
                embeds: [createQueueEmbed(interaction.guild)], 
                components: [getQueueButtons()] 
            });
            return interaction.reply({ content: "✅ Sıra paneli kuruldu.", ephemeral: true });
        }
    }

    // --- BUTTON INTERACTION HANDLER ---
    if (interaction.isButton()) {
        const customId = interaction.customId;
        const user = interaction.user;
        const member = interaction.member;
        const now = Date.now();

        // 1. Waitlist Al Butonu
        if (customId === 'main_smp_waitlist_btn') {
            if (cooldowns.has(user.id) && now < cooldowns.get(user.id)) {
                const remaining = cooldowns.get(user.id) - now;
                const days = Math.floor(remaining / (24 * 3600 * 1000));
                const hours = Math.floor((remaining % (24 * 3600 * 1000)) / (3600 * 1000));
                const minutes = Math.floor((remaining % (3600 * 1000)) / (60 * 1000));

                return interaction.reply({ 
                    content: `⚠️ **Waitlist Cooldown!** Tekrar başvuru için **${days} gün, ${hours} saat, ${minutes} dakika** beklemelisiniz.`, 
                    ephemeral: true 
                });
            }

            const role = interaction.guild.roles.cache.get(WAITLIST_ROLE_ID);
            if (role) {
                if (member.roles.cache.has(WAITLIST_ROLE_ID)) {
                    return interaction.reply({ content: "❌ Zaten **SMP Waitlist** rolüne sahipsiniz!", ephemeral: true });
                }

                await member.roles.add(role);
                const isBooster = member.roles.cache.has(BOOSTER_ROLE_ID);
                const cooldownTime = isBooster ? BOOSTER_COOLDOWN : NORMAL_COOLDOWN;
                cooldowns.set(user.id, now + cooldownTime);

                return interaction.reply({ content: "✅ **SMP Waitlist** rolünüz verildi! Test sırası kanalına erişebilirsiniz.", ephemeral: true });
            } else {
                return interaction.reply({ content: "❌ Rol bulunamadı.", ephemeral: true });
            }
        }

        // 2. Cooldown Kontrol
        if (customId === 'main_cooldown_check_btn') {
            if (cooldowns.has(user.id) && now < cooldowns.get(user.id)) {
                const remaining = cooldowns.get(user.id) - now;
                const days = Math.floor(remaining / (24 * 3600 * 1000));
                const hours = Math.floor((remaining % (24 * 3600 * 1000)) / (3600 * 1000));
                const minutes = Math.floor((remaining % (3600 * 1000)) / (60 * 1000));

                return interaction.reply({ content: `⏱️ Bekleme sürenizin bitmesine **${days} gün, ${hours} saat, ${minutes} dakika** kaldı.`, ephemeral: true });
            }
            return interaction.reply({ content: "✅ Herhangi bir bekleme süreniz yok!", ephemeral: true });
        }

        // 3. Sıraya Katıl
        if (customId === 'btn_queue_join') {
            if (!queueData.isOpen) {
                return interaction.reply({ content: "❌ Test sırası şu an **KAPALI**.", ephemeral: true });
            }

            if (queueData.queue.includes(user.id)) {
                return interaction.reply({ content: "❌ Zaten sıradasınız!", ephemeral: true });
            }

            if (queueData.queue.length >= MAX_QUEUE_CAPACITY) {
                return interaction.reply({ content: "❌ Sıra doldu!", ephemeral: true });
            }

            const isBooster = member.roles.cache.has(BOOSTER_ROLE_ID);
            if (isBooster) {
                let insertIndex = queueData.queue.length;
                for (let i = 0; i < queueData.queue.length; i++) {
                    const qMember = interaction.guild.members.cache.get(queueData.queue[i]);
                    if (qMember && !qMember.roles.cache.has(BOOSTER_ROLE_ID)) {
                        insertIndex = i;
                        break;
                    }
                }
                queueData.queue.splice(insertIndex, 0, user.id);
            } else {
                queueData.queue.push(user.id);
            }

            await interaction.message.edit({ embeds: [createQueueEmbed(interaction.guild)] });
            return interaction.reply({ content: "✅ Sıraya katıldınız!", ephemeral: true });
        }

        // 4. Sıradan Ayrıl / Kitten Ayrıl
        if (customId === 'btn_queue_leave' || customId === 'btn_queue_kit_leave') {
            if (!queueData.queue.includes(user.id)) {
                return interaction.reply({ content: "❌ Sırada değilsiniz.", ephemeral: true });
            }

            queueData.queue = queueData.queue.filter(id => id !== user.id);
            await interaction.message.edit({ embeds: [createQueueEmbed(interaction.guild)] });
            return interaction.reply({ content: "✅ Sıradan ayrıldınız.", ephemeral: true });
        }

        // 5. Tester Paneli Butonu
        if (customId === 'btn_queue_tester_panel') {
            const isTester = member.roles.cache.has(TESTER_ROLE_ID) || member.permissions.has(PermissionFlagsBits.Administrator);
            if (!isTester) {
                return interaction.reply({ content: "❌ Bu paneli sadece **Tester** yetkilileri kullanabilir!", ephemeral: true });
            }

            return interaction.reply({ 
                content: "🛠️ **Tester Kontrol Paneli**", 
                components: [getTesterPanelButtons()], 
                ephemeral: true 
            });
        }

        // Tester Panel İçi Butonlar
        if (customId === 'tp_toggle') {
            queueData.isOpen = !queueData.isOpen;
            if (queueData.isOpen) {
                queueData.activeTesters.add(user.id);
            } else {
                queueData.activeTesters.delete(user.id);
            }

            // Test sırası mesajını güncellemek için kanal içindeki paneller aranabilir veya mesaj editlenebilir.
            return interaction.reply({ content: `✅ Sıra durumu değiştirildi: **${queueData.isOpen ? "AÇIK" : "KAPALI"}**`, ephemeral: true });
        }

        if (customId === 'tp_next') {
            if (queueData.queue.length === 0) {
                return interaction.reply({ content: "❌ Sıra boş!", ephemeral: true });
            }

            const nextUserId = queueData.queue.shift();
            return interaction.reply({ content: `🔔 Sıradaki Oyuncu: <@${nextUserId}>! Lütfen teste gelin.`, ephemeral: false });
        }

        if (customId === 'tp_clear') {
            queueData.queue = [];
            return interaction.reply({ content: "🧹 Sıra temizlendi.", ephemeral: true });
        }
    }
});

client.login(TOKEN);
