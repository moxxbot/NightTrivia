// Import required dependencies
require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActivityType
} = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const winston = require('winston');
const fs = require('fs').promises;
const cron = require('node-cron');

// Bot Configuration
const BOT_INFO = {
    name: 'NightTrivia',
    version: '1.2.6'
};

// Visual Theming
const THEME = {
    color: '#4169E1', // Royal Blue
    buttons: ButtonStyle.Primary,
    emoji: {
        crown: '👑',
        points: '🌟',
        correct: '✅',
        wrong: '❌',
        stats: '📊',
        time: '⏳',
        category: '📚',
        players: '👥',
        answer: '🎯',
        progress: '📈',
        medal: {
            first: '🏆',
            second: '🥈',
            third: '🥉'
        }
    }
};

// Configure logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Bot state
let currentSession = null;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];

// Helper Functions
function createProgressBar(current, max, size = 15) {
    const progress = Math.round((current / max) * size);
    return '▰'.repeat(progress) + '▱'.repeat(size - progress);
}

// Vote Messages
const voteMessages = [
    "locked in their answer",
    "is ready to rumble",
    "jumped into action",
    "made their choice",
    "took their shot",
    "stepped up to the plate",
    "showed their knowledge",
    "threw their hat in the ring",
    "entered the arena",
    "made their move",
    "took a chance",
    "put their knowledge to the test",
    "joined the challenge",
    "accepted the challenge",
    "made their play",
    "stepped into the spotlight",
    "gave it their best shot",
    "rose to the occasion",
    "answered the call",
    "made their mark"
];

// File Management
async function loadAskedQuestions() {
    try {
        const data = await fs.readFile('asked_questions.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.info('No asked questions file found, creating new one');
        return { 
            questions: [],
            lastReset: new Date().toISOString()
        };
    }
}

async function saveAskedQuestions(askedQuestions) {
    try {
        await fs.writeFile('asked_questions.json', JSON.stringify(askedQuestions, null, 2));
    } catch (error) {
        logger.error('Error saving asked questions:', error);
        throw error;
    }
}

async function loadScores() {
    try {
        const data = await fs.readFile('scores.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        logger.error('Error loading scores:', error);
        return {};
    }
}

async function saveScores(scores) {
    try {
        await fs.writeFile('scores.json', JSON.stringify(scores, null, 2));
    } catch (error) {
        logger.error('Error saving scores:', error);
        throw error;
    }
}

async function loadQuestions() {
    try {
        const data = await fs.readFile('questions.json', 'utf8');
        return JSON.parse(data).questions || [];
    } catch (error) {
        logger.error('Error loading questions:', error);
        return [];
    }
}

async function getRandomQuestion() {
    try {
        const questions = await loadQuestions();
        if (questions.length === 0) return null;

        // Load asked questions
        const askedQuestionsData = await loadAskedQuestions();
        let askedQuestions = askedQuestionsData.questions;
        
        // Check if we should reset asked questions
        const availableQuestions = questions.filter(q => !askedQuestions.includes(q.question));
        
        if (availableQuestions.length === 0) {
            logger.info('All questions have been asked, resetting tracking');
            askedQuestions = [];
            await saveAskedQuestions({ 
                questions: [],
                lastReset: new Date().toISOString()
            });
        }

        // Select random question from available ones
        const question = availableQuestions.length > 0 ? 
            availableQuestions[Math.floor(Math.random() * availableQuestions.length)] :
            questions[Math.floor(Math.random() * questions.length)];

        // Add to asked questions
        if (!askedQuestions.includes(question.question)) {
            askedQuestions.push(question.question);
            await saveAskedQuestions({
                questions: askedQuestions,
                lastReset: askedQuestionsData.lastReset
            });
        }

        return question;
    } catch (error) {
        logger.error('Error in getRandomQuestion:', error);
        return null;
    }
}

// Command Definitions
const commands = [
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows bot commands and information'),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View trivia statistics')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the leaderboard')
        .addIntegerOption(option =>
            option.setName('page')
                .setDescription('Page number')
                .setMinValue(1)
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('points')
        .setDescription('Manage points')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add points')
                .addUserOption(option => 
                    option.setName('user')
                        .setDescription('Target user')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('amount')
                        .setDescription('Amount')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand.setName('remove')
                .setDescription('Remove points')
                .addUserOption(option => 
                    option.setName('user')
                        .setDescription('Target user')
                        .setRequired(true))
                .addIntegerOption(option => 
                    option.setName('amount')
                        .setDescription('Amount')
                        .setRequired(true)
                        .setMinValue(1))),

    new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Manage trivia sessions')
        .addSubcommand(subcommand =>
            subcommand.setName('status')
                .setDescription('Check current trivia status'))
        .addSubcommand(subcommand =>
            subcommand.setName('start')
                .setDescription('Start a new trivia session'))
        .addSubcommand(subcommand =>
            subcommand.setName('force-end')
                .setDescription('Force end the current session'))
];

// Register commands with Discord
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        logger.info('Successfully registered application commands.');
    } catch (error) {
        logger.error('Error registering application commands:', error);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Session Management
async function startTriviaSession() {
    try {
        if (currentSession) {
            logger.warn('Trivia session already in progress');
            return false;
        }

        const channel = await client.channels.fetch(process.env.TRIVIA_CHANNEL_ID);
        if (!channel) {
            logger.error('Trivia channel not found');
            return false;
        }

        const question = await getRandomQuestion();
        if (!question) {
            logger.error('No questions available');
            return false;
        }

        question.options = shuffleArray(question.options);
        
        const embed = createTriviaEmbed(question);
        const buttons = createButtons();
        
        const message = await channel.send({
            embeds: [embed],
            components: [buttons]
        });

        currentSession = {
            messageId: message.id,
            question,
            votes: new Map(),
            startTime: Date.now()
        };

        logger.info('Started new trivia session');
        return true;
    } catch (error) {
        logger.error('Failed to start trivia session:', error);
        return false;
    }
}

async function showResults() {
    if (!currentSession) return;

    try {
        const channel = await client.channels.fetch(process.env.TRIVIA_CHANNEL_ID);
        const message = await channel.messages.fetch(currentSession.messageId);
        
        await message.edit({ components: [] });

        const correctOptionIndex = currentSession.question.options.indexOf(currentSession.question.correct_answer);
        const correctOption = String.fromCharCode(65 + correctOptionIndex);

        const scores = await loadScores();
        const results = [];

        // Calculate points
        for (const [userId, voteData] of currentSession.votes) {
            const isCorrect = voteData.option === correctOption;
            const hoursElapsed = (voteData.timestamp - currentSession.startTime) / (1000 * 60 * 60);
            const hoursRemaining = Math.max(0, 5 - hoursElapsed);
            const points = isCorrect ? Math.ceil(hoursRemaining) : -1;

            const userScore = scores[userId] || {
                username: voteData.username,
                points: 0,
                correct: 0,
                total: 0
            };

            userScore.total++;
            userScore.points = Math.max(0, userScore.points + points);
            if (isCorrect) {
                userScore.correct++;
            }
            userScore.username = voteData.username;
            scores[userId] = userScore;

            results.push({
                username: voteData.username,
                correct: isCorrect,
                points,
                totalPoints: userScore.points
            });
        }

        await saveScores(scores);

        const resultsEmbed = new EmbedBuilder()
            .setTitle(`${THEME.emoji.stats} Question Results`)
            //.setDescription(`**Question:** ${currentSession.question.question}`)
            .setDescription(`**Question:** ${currentSession.question.question}\n**Correct Answer:** ${currentSession.question.correct_answer}\n**Explanation:** ${(currentSession.question.answer_reason ?? "Non Explanation was specified for this question.")}`)
            .addFields(
                /*{ 
                    name: `${THEME.emoji.answer} Correct Answer`, 
                    value: `**${correctOption} •** ${currentSession.question.correct_answer}`, 
                    inline: true 
                },
                { 
                    name: `${THEME.emoji.category} Category`, 
                    value: currentSession.question.category, 
                    inline: true 
                },
                  { 
                    name: `Explanation`, 
                    value: (currentSession.question.answer_reason ?? "Non Explanation was specified for this question."), 
                    inline: true 
                },*/
                {
                    name: `${THEME.emoji.progress} Results`,
                    value: results.length ? results
                        .sort((a, b) => b.points - a.points)
                        .map((r, i) => {
                            const medal = i === 0 ? THEME.emoji.medal.first : 
                                        i === 1 ? THEME.emoji.medal.second : 
                                        i === 2 ? THEME.emoji.medal.third : '•';
                            return `${medal} ${r.username}: ${r.correct ? THEME.emoji.correct : THEME.emoji.wrong} ${r.points > 0 ? `+${r.points}` : r.points} points`;
                        })
                        .join('\n') : 'No answers received'
                }
            )
            .setColor(THEME.color)
            .setTimestamp();

        await channel.send({ embeds: [resultsEmbed] });
        
        currentSession = null;
        logger.info('Posted trivia results');

    } catch (error) {
        logger.error('Error showing results:', error);
        currentSession = null;
    }
}

// UI Components
function createTriviaEmbed(question) {
    return new EmbedBuilder()
        .setTitle(`${THEME.emoji.category} NightTrivia Question`)
        .setDescription(`**${question.question}**`)
        .addFields({
            name: `${THEME.emoji.answer} Options`,
            value: question.options.map((opt, i) => 
                `${String.fromCharCode(65 + i)} • ${opt}`
            ).join('\n')
        })
        .setColor(THEME.color)
        .setFooter({ 
            text: 'Answer within 5 hours • Earlier answers = More points!' 
        })
        .setTimestamp();
}

function createButtons() {
    const row = new ActionRowBuilder();
    ['A', 'B', 'C', 'D'].forEach((option) => {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`vote_${option}`)
                .setLabel(option)
                .setStyle(THEME.buttons)
        );
    });
    return row;
}

// Command Handlers
async function handleHelp(interaction) {
    const helpEmbed = new EmbedBuilder()
        .setTitle(`${BOT_INFO.name} Help Guide`)
        .setDescription('Welcome to NightTrivia! Test your knowledge and compete with others.')
        .addFields(
            {
                name: '📝 Commands',
                value: `
• **/stats** - View your or another user's statistics
• **/leaderboard** - See the global rankings
• **/help** - Show this help message

${THEME.emoji.crown} **Admin Commands**
• **/trivia start** - Start a new trivia session
• **/trivia status** - Check current session status
• **/trivia force-end** - End current session
• **/points add/remove** - Modify user points`
            },
            {
                name: '🎮 How to Play',
                value: `
1. Questions appear every 6 hours
2. Click the button with your answer
3. Earlier correct answers earn more points
4. Wrong answers lose 1 point
5. Results show after 5 hours`
            }
        )
        .setColor(THEME.color)
        .setTimestamp();

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
}

async function handleLeaderboard(interaction) {
    try {
        const page = interaction.options.getInteger('page') || 1;
        const itemsPerPage = 10;
        const scores = await loadScores();
        
        const sortedScores = Object.entries(scores)
            .sort(([,a], [,b]) => b.points - a.points);
        
        const totalPages = Math.ceil(sortedScores.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const pageScores = sortedScores.slice(startIndex, startIndex + itemsPerPage);

        if (pageScores.length === 0) {
            await interaction.reply({
                content: page > totalPages ? 
                    `${THEME.emoji.wrong} Invalid page number. Total pages: ${totalPages}` : 
                    `${THEME.emoji.wrong} No scores found!`,
                ephemeral: true
            });
            return;
        }

        const leaderboardEmbed = new EmbedBuilder()
            .setTitle(`${THEME.emoji.crown} NightTrivia Leaderboard`)
            .setDescription(pageScores.map(([, score], index) => {
                const position = startIndex + index + 1;
                const medal = position === 1 ? THEME.emoji.medal.first : 
                            position === 2 ? THEME.emoji.medal.second : 
                            position === 3 ? THEME.emoji.medal.third : '•';
                const accuracy = score.total ? Math.round((score.correct / score.total) * 100) : 0;
                return `${medal} **${score.username}** ${THEME.emoji.points} ${score.points} pts (${accuracy}% correct)`;
            }).join('\n'))
            .setColor(THEME.color)
            .setFooter({ 
                text: `Page ${page}/${totalPages} • ${sortedScores.length} Total Players` 
            })
            .setTimestamp();

        await interaction.reply({ embeds: [leaderboardEmbed] });
    } catch (error) {
        logger.error('Error handling leaderboard:', error);
        await interaction.reply({ 
            content: `${THEME.emoji.wrong} Failed to retrieve leaderboard.`,
            ephemeral: true 
        });
    }
}

async function handleStats(interaction) {
    try {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const scores = await loadScores();
        const userScore = scores[targetUser.id] || { 
            points: 0, 
            correct: 0, 
            total: 0
        };
        
        const accuracy = userScore.total ? Math.round((userScore.correct / userScore.total) * 100) : 0;
        const rank = Object.values(scores)
            .sort((a, b) => b.points - a.points)
            .findIndex(score => score.points <= userScore.points) + 1;
        
        const statsEmbed = new EmbedBuilder()
            .setTitle(`${THEME.emoji.stats} Player Statistics`)
            .setDescription(`Statistics for **${targetUser.username}**`)
            .addFields(
                { 
                    name: `${THEME.emoji.crown} Rank`, 
                    value: `#${rank}`, 
                    inline: true 
                },
                { 
                    name: `${THEME.emoji.points} Points`, 
                    value: userScore.points.toString(), 
                    inline: true 
                },
                { 
                    name: `${THEME.emoji.progress} Accuracy`, 
                    value: `${accuracy}%`, 
                    inline: true 
                },
                {
                    name: `${THEME.emoji.stats} Performance`,
                    value: `Correct Answers: ${userScore.correct}/${userScore.total}`
                }
            )
            .setColor(THEME.color)
            .setTimestamp();

        await interaction.reply({ embeds: [statsEmbed] });
    } catch (error) {
        logger.error('Error handling stats:', error);
        await interaction.reply({ 
            content: `${THEME.emoji.wrong} Failed to retrieve stats.`,
            ephemeral: true 
        });
    }
}

async function handlePoints(interaction) {
    try {
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const isAdd = subcommand === 'add';

        const scores = await loadScores();
        const userScore = scores[targetUser.id] || {
            username: targetUser.username,
            points: 0,
            correct: 0,
            total: 0
        };

        if (isAdd) {
            userScore.points += amount;
        } else {
            userScore.points = Math.max(0, userScore.points - amount);
        }

        scores[targetUser.id] = userScore;
        await saveScores(scores);

        const pointsEmbed = new EmbedBuilder()
            .setTitle(`${THEME.emoji.points} Points ${isAdd ? 'Added' : 'Removed'}`)
            .setDescription(
                `${isAdd ? '➕' : '➖'} ${amount} points ${isAdd ? 'to' : 'from'} ${targetUser.username}\n` +
                `${THEME.emoji.stats} New total: ${userScore.points} points`
            )
            .setColor(THEME.color)
            .setTimestamp();

        await interaction.reply({ embeds: [pointsEmbed] });
    } catch (error) {
        logger.error('Error handling points command:', error);
        await interaction.reply({ 
            content: `${THEME.emoji.wrong} Failed to update points.`,
            ephemeral: true 
        });
    }
}

async function handleTrivia(interaction) {
    try {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'status':
                if (!currentSession) {
                    await interaction.reply({
                        content: `${THEME.emoji.info} No active trivia session.`,
                        ephemeral: true
                    });
                    return;
                }
                
                const timeElapsed = (Date.now() - currentSession.startTime) / (1000 * 60);
                const timeRemaining = Math.max(0, 300 - timeElapsed);
                const hoursRemaining = Math.floor(timeRemaining / 60);
                const minutesRemaining = Math.floor(timeRemaining % 60);
                
                const statusEmbed = new EmbedBuilder()
                    .setTitle(`${THEME.emoji.stats} Current Trivia Status`)
                    .setDescription(`**Current Question:**\n${currentSession.question.question}`)
                    .addFields(
                        { 
                            name: `${THEME.emoji.category} Category`, 
                            value: currentSession.question.category, 
                            inline: true 
                        },
                        { 
                            name: `${THEME.emoji.players} Answers`, 
                            value: currentSession.votes.size.toString(), 
                            inline: true 
                        },
                        { 
                            name: `${THEME.emoji.time} Time Remaining`, 
                            value: `${hoursRemaining}h ${minutesRemaining}m`, 
                            inline: true 
                        }
                    )
                    .setColor(THEME.color)
                    .setFooter({ 
                        text: `Maximum points available: ${Math.ceil(timeRemaining / 60)}` 
                    })
                    .setTimestamp();
                    
                await interaction.reply({ embeds: [statusEmbed] });
                break;

            case 'start':
                if (currentSession) {
                    await interaction.reply({
                        content: `${THEME.emoji.wrong} A trivia session is already in progress!`,
                        ephemeral: true
                    });
                    return;
                }
                
                const success = await startTriviaSession();
                await interaction.reply({
                    content: success ? 
                        `${THEME.emoji.correct} New trivia session started!` : 
                        `${THEME.emoji.wrong} Failed to start trivia session. Check logs for details.`,
                    ephemeral: true
                });
                break;

            case 'force-end':
                if (!currentSession) {
                    await interaction.reply({
                        content: `${THEME.emoji.wrong} No active trivia session to end.`,
                        ephemeral: true
                    });
                    return;
                }
                
                await interaction.deferReply();
                
                try {
                    await showResults();
                    await interaction.editReply(`${THEME.emoji.correct} Trivia session ended and results posted.`);
                } catch (error) {
                    logger.error('Error in force-end:', error);
                    await interaction.editReply(`${THEME.emoji.wrong} Error ending trivia session.`);
                }
                break;
        }
    } catch (error) {
        logger.error('Error handling trivia command:', error);
        await interaction.reply({ 
            content: `${THEME.emoji.wrong} Failed to process trivia command.`,
            ephemeral: true 
        });
    }
}

// Event Handlers
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton() && interaction.customId.startsWith('vote_')) {
            if (!currentSession || currentSession.messageId !== interaction.message.id) {
                await interaction.reply({ 
                    content: `${THEME.emoji.wrong} This question has ended!`, 
                    ephemeral: true 
                });
                return;
            }

            const userId = interaction.user.id;
            if (currentSession.votes.has(userId)) {
                await interaction.reply({ 
                    content: `${THEME.emoji.wrong} You've already answered!`, 
                    ephemeral: true 
                });
                return;
            }

            const option = interaction.customId.split('_')[1];
            currentSession.votes.set(userId, {
                option,
                username: interaction.user.username,
                timestamp: Date.now()
            });

            const randomMessage = voteMessages[Math.floor(Math.random() * voteMessages.length)];
            await interaction.reply(`${THEME.emoji.correct} **${interaction.user.username}** ${randomMessage}!`);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        if (!ADMIN_IDS.includes(interaction.user.id) && 
            ['trivia', 'points'].includes(interaction.commandName)) {
            await interaction.reply({
                content: `${THEME.emoji.wrong} You don't have permission to use this command.`,
                ephemeral: true
            });
            return;
        }

        switch (interaction.commandName) {
            case 'help':
                await handleHelp(interaction);
                break;
            case 'stats':
                await handleStats(interaction);
                break;
            case 'leaderboard':
                await handleLeaderboard(interaction);
                break;
            case 'points':
                await handlePoints(interaction);
                break;
            case 'trivia':
                await handleTrivia(interaction);
                break;
        }
    } catch (error) {
        logger.error('Error handling interaction:', error);
        try {
            const reply = interaction.replied ? interaction.followUp : interaction.reply;
            await reply.call(interaction, {
                content: `${THEME.emoji.wrong} An error occurred while processing your request.`,
                ephemeral: true
            });
        } catch (e) {
            logger.error('Error sending error message:', e);
        }
    }
});

// Setup cron jobs
function setupCronJobs() {
    // Start new question every 6 hours
    cron.schedule('0 0,6,12,18 * * *', async () => {
        logger.info('Starting new trivia session via cron');
        await startTriviaSession();
    });

    // Show results 5 hours after each question
    cron.schedule('0 5,11,17,23 * * *', async () => {
        logger.info('Showing results via cron');
        await showResults();
    });
}

// Error Handling
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

// Bot startup
client.once('ready', async () => {
    logger.info(`Logged in as ${client.user.tag}`);
    
    client.user.setPresence({
        activities: [{ 
            name: `trivia • /help`,
            type: ActivityType.Playing
        }],
        status: 'online'
    });

    await registerCommands();
    setupCronJobs();
    logger.info(`${BOT_INFO.name} is ready!`);
});

// Start the bot
client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        logger.info(`${BOT_INFO.name} v${BOT_INFO.version} started successfully`);
    })
    .catch(error => {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    });

module.exports = {
    client,
    startTriviaSession,
    showResults,
    createProgressBar,
    loadScores,
    saveScores,
    loadQuestions
};