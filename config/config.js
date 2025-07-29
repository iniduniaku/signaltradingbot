require('dotenv').config();

module.exports = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID
  },
  exchange: {
    name: process.env.EXCHANGE_NAME || 'binance',
    options: {
      enableRateLimit: true,
      sandbox: false
    }
  },
  scanning: {
    intervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES) || 15,
    minVolumeUSDT: parseInt(process.env.MIN_VOLUME_USDT) || 100000,
    maxTokensPerScan: parseInt(process.env.MAX_TOKENS_PER_SCAN) || 50
  },
  indicators: {
    rsi: {
      period: 14,
      oversold: 30,
      overbought: 70,
      weight: 25
    },
    macd: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      weight: 20
    },
    bollinger: {
      period: 20,
      stdDev: 2,
      weight: 15
    },
    stochastic: {
      kPeriod: 14,
      dPeriod: 3,
      weight: 10
    },
    pivot: {
      weight: 30
    }
  },
  signal: {
    minConfidence: 60,
    highConfidence: 75
  }
};
