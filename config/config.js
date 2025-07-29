require('dotenv').config();

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID
  },
  
  exchange: {
    name: process.env.EXCHANGE_NAME || 'binance',
    sandbox: process.env.EXCHANGE_SANDBOX === 'true',
    options: {
      enableRateLimit: true,
      timeout: 30000,
      rateLimit: 1200
    }
  },
  
  scanning: {
    intervalMinutes: parseInt(process.env.SCAN_INTERVAL_MINUTES) || 10,
    minVolumeUSDT: parseInt(process.env.MIN_VOLUME_USDT) || 500000,
    maxTokensPerScan: parseInt(process.env.MAX_TOKENS_PER_SCAN) || 30,
    timeframe: '1h',
    candleLimit: 100
  },
  
  indicators: {
    ema: {
      fast: 8,
      medium: 21,
      slow: 50,
      weight: 15
    },
    supertrend: {
      period: 10,
      multiplier: 3.0,
      weight: 15
    },
    mfi: {
      period: 14,
      oversold: 20,
      overbought: 80,
      weight: 10
    },
    williamsR: {
      period: 14,
      oversold: -80,
      overbought: -20,
      weight: 8
    },
    cci: {
      period: 20,
      oversold: -100,
      overbought: 100,
      weight: 7
    },
    vwap: {
      period: 100,
      weight: 20
    },
    marketStructure: {
      lookback: 20,
      weight: 10
    },
    ichimoku: {
      tenkan: 9,
      kijun: 26,
      senkou: 52,
      weight: 10
    },
    parabolicSAR: {
      step: 0.02,
      maxStep: 0.2,
      weight: 5
    }
  },
  
  futures: {
    fundingRate: {
      weight: 15,
      extremeThreshold: 0.01
    },
    openInterest: {
      enabled: true,
      significantChange: 0.1
    },
    liquidations: {
      enabled: true,
      lookbackMinutes: 60
    }
  },
  
  riskManagement: {
    atrPeriod: 14,
    volatilityPeriod: 20,
    supportResistanceLookback: 25,
    defaultRiskPercentage: parseFloat(process.env.DEFAULT_RISK_PERCENTAGE) || 1.5,
    defaultAccountBalance: parseFloat(process.env.DEFAULT_ACCOUNT_BALANCE) || 1000,
    minRiskReward: parseFloat(process.env.MIN_RISK_REWARD) || 2.0,
    maxLeverage: parseInt(process.env.MAX_LEVERAGE) || 10,
    takeProfitMultipliers: {
      high: [2.0, 3.5, 5.5],
      medium: [1.5, 2.8, 4.2]
    },
    stopLossMultipliers: {
      high: 1.2,
      medium: 1.8
    }
  },
  
  signal: {
    minConfidence: parseInt(process.env.MIN_CONFIDENCE) || 65,
    highConfidence: parseInt(process.env.HIGH_CONFIDENCE) || 80,
    cooldownMinutes: 30
  },
  
  features: {
    fundingAnalysis: process.env.ENABLE_FUNDING_ANALYSIS === 'true',
    liquidationAnalysis: process.env.ENABLE_LIQUIDATION_ANALYSIS === 'true',
    tradeMonitoring: process.env.ENABLE_TRADE_MONITORING === 'true'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    toFile: process.env.LOG_TO_FILE === 'true',
    maxFiles: 5,
    maxSize: '10m'
  }
};

module.exports = config;
