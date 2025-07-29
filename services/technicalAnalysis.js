const futuresIndicators = require('./futuresIndicators');
const fundingRateService = require('./fundingRateService');
const riskManagement = require('./riskManagement');
const config = require('../config/config');
const logger = require('../utils/logger');

class FuturesTechnicalAnalysis {
  constructor() {
    this.signalCache = new Map();
    this.cacheDuration = 5 * 60 * 1000; // 5 minutes
  }

  async analyzeToken(symbol, ohlcv) {
    try {
      // Check cache first
      const cacheKey = `${symbol}_${ohlcv[ohlcv.length - 1].timestamp}`;
      const cached = this.signalCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheDuration) {
        return cached.data;
      }

      if (!ohlcv || ohlcv.length < 60) {
        return null;
      }

      const closes = ohlcv.map(candle => candle.close);
      const currentPrice = closes[closes.length - 1];

      // Calculate all technical indicators
      const indicators = await this.calculateAllIndicators(symbol, ohlcv);
      
      if (!this.hasRequiredIndicators(indicators)) {
        return null;
      }

      // Generate signal with futures-specific logic
      const signal = this.generateFuturesSignal(currentPrice, indicators);
      
      if (!signal) {
        return null;
      }

      // Calculate risk management parameters
      const riskParams = this.calculateRiskParameters(currentPrice, signal, indicators);
      
      if (!riskParams) {
        return null;
      }

      // Validate risk parameters
      const riskValidation = riskManagement.validateRiskParameters(
        riskParams.entryPrice, 
        riskParams.stopLoss, 
        riskParams.takeProfits, 
        riskParams.positionInfo
      );

      // Only return signal if risk is acceptable
      if (!riskValidation.isValid || riskValidation.riskLevel === 'EXTREME') {
        logger.debug(`Signal rejected for ${symbol}: Risk level ${riskValidation.riskLevel}`);
        return null;
      }

      const analysisResult = {
        symbol,
        currentPrice,
        ...riskParams,
        timestamp: new Date(),
        indicators,
        signal: {
          ...signal,
          riskLevel: riskValidation.riskLevel,
          warnings: riskValidation.warnings
        }
      };

      // Cache the result
      this.signalCache.set(cacheKey, {
        data: analysisResult,
        timestamp: Date.now()
      });

      return analysisResult;
      
    } catch (error) {
      logger.error(`Futures analysis error for ${symbol}: ${error.message}`);
      return null;
    }
  }

  async calculateAllIndicators(symbol, ohlcv) {
    try {
      const closes = ohlcv.map(candle => candle.close);
      
      // Trend indicators
      const ema8 = futuresIndicators.calculateEMA(closes, config.indicators.ema.fast);
      const ema21 = futuresIndicators.calculateEMA(closes, config.indicators.ema.medium);
      const ema50 = futuresIndicators.calculateEMA(closes, config.indicators.ema.slow);
      const supertrend = futuresIndicators.calculateSupertrend(
        ohlcv, 
        config.indicators.supertrend.period, 
        config.indicators.supertrend.multiplier
      );
      const ichimoku = futuresIndicators.calculateIchimoku(ohlcv);
      const marketStructure = futuresIndicators.calculateMarketStructure(
        ohlcv, 
        config.indicators.marketStructure.lookback
      );

      // Momentum indicators
      const mfi = futuresIndicators.calculateMFI(ohlcv, config.indicators.mfi.period);
      const williamsR = futuresIndicators.calculateWilliamsR(ohlcv, config.indicators.williamsR.period);
      const cci = futuresIndicators.calculateCCI(ohlcv, config.indicators.cci.period);

      // Volume indicators
      const vwap = futuresIndicators.calculateVWAP(ohlcv.slice(-config.indicators.vwap.period));
      const obv = futuresIndicators.calculateOBV(ohlcv);

      // Futures-specific data
      const [fundingData, openInterest, liquidationData] = await Promise.all([
        fundingRateService.getFundingRate(symbol),
        fundingRateService.getOpenInterest(symbol),
        fundingRateService.getLiquidationData(symbol)
      ]);

      // Risk management indicators
      const atr = riskManagement.calculateATR(ohlcv, config.riskManagement.atrPeriod);
      const volatility = riskManagement.calculateVolatility(closes, config.riskManagement.volatilityPeriod);
      const supportResistance = riskManagement.calculateSupportResistance(
        ohlcv, 
        config.riskManagement.supportResistanceLookback
      );

      return {
        trend: {
          ema8,
          ema21,
          ema50,
          supertrend,
          ichimoku,
          marketStructure
        },
        momentum: {
          mfi,
          williamsR,
          cci
        },
        volume: {
          vwap,
          obv
        },
        futures: {
          fundingRate: fundingData?.fundingRate || 0,
          markPrice: fundingData?.markPrice || 0,
          openInterest: openInterest?.openInterest || 0,
          liquidationData: liquidationData || {}
        },
        risk: {
          atr,
          volatility,
          supportResistance
        }
      };
    } catch (error) {
      logger.error(`Error calculating indicators for ${symbol}: ${error.message}`);
      return null;
    }
  }

  hasRequiredIndicators(indicators) {
    return indicators && 
           indicators.trend.ema8 && 
           indicators.trend.ema21 && 
           indicators.trend.supertrend && 
           indicators.momentum.mfi && 
           indicators.volume.vwap && 
           indicators.risk.atr;
  }

  generateFuturesSignal(price, indicators) {
    try {
      let longScore = 0;
      let shortScore = 0;
      let totalWeight = 0;
      const analysis = {};

      // Trend Analysis (40% total weight)
      const trendAnalysis = this.analyzeTrend(price, indicators.trend);
      longScore += trendAnalysis.longScore;
      shortScore += trendAnalysis.shortScore;
      totalWeight += trendAnalysis.weight;
      analysis.trend = trendAnalysis.details;

      // Momentum Analysis (25% total weight)
      const momentumAnalysis = this.analyzeMomentum(indicators.momentum);
      longScore += momentumAnalysis.longScore;
      shortScore += momentumAnalysis.shortScore;
      totalWeight += momentumAnalysis.weight;
      analysis.momentum = momentumAnalysis.details;

      // Volume Analysis (20% total weight)
      const volumeAnalysis = this.analyzeVolume(price, indicators.volume);
      longScore += volumeAnalysis.longScore;
      shortScore += volumeAnalysis.shortScore;
      totalWeight += volumeAnalysis.weight;
      analysis.volume = volumeAnalysis.details;

      // Futures-specific Analysis (15% total weight)
      const futuresAnalysis = this.analyzeFuturesData(indicators.futures);
      longScore += futuresAnalysis.longScore;
      shortScore += futuresAnalysis.shortScore;
      totalWeight += futuresAnalysis.weight;
      analysis.futures = futuresAnalysis.details;

      // Calculate final scores
      const longStrength = (longScore / totalWeight) * 100;
      const shortStrength = (shortScore / totalWeight) * 100;

      // Determine signal
      if (longStrength >= config.signal.minConfidence) {
        return {
          direction: 'LONG',
          strength: longStrength,
          confidence: longStrength >= config.signal.highConfidence ? 'HIGH' : 'MEDIUM',
          analysis: analysis
        };
      } else if (shortStrength >= config.signal.minConfidence) {
        return {
          direction: 'SHORT',
          strength: shortStrength,
          confidence: shortStrength >= config.signal.highConfidence ? 'HIGH' : 'MEDIUM',
          analysis: analysis
        };
      }

      return null;
    } catch (error) {
      logger.error(`Signal generation error: ${error.message}`);
      return null;
    }
  }

  analyzeTrend(price, trendIndicators) {
    let longScore = 0;
    let shortScore = 0;
    const weight = 40;
    const details = {};

    // EMA Analysis (15 points)
    if (trendIndicators.ema8 && trendIndicators.ema21 && trendIndicators.ema50) {
      const emaAlignment = this.getEMAAlignment(trendIndicators);
      details.emaAlignment = emaAlignment;
      
      if (emaAlignment === 'STRONG_BULL') {
        longScore += 15;
      } else if (emaAlignment === 'STRONG_BEAR') {
        shortScore += 15;
      } else if (emaAlignment === 'BULL') {
        longScore += 10;
      } else if (emaAlignment === 'BEAR') {
        shortScore += 10;
      }
    }

    // Supertrend Analysis (15 points)
    if (trendIndicators.supertrend) {
      const st = trendIndicators.supertrend;
      details.supertrend = {
        trend: st.trend,
        value: st.value,
        distance: ((price - st.value) / price * 100).toFixed(2)
      };
      
      if (st.trend === 1 && price > st.value * 1.001) {
        longScore += 15;
      } else if (st.trend === -1 && price < st.value * 0.999) {
        shortScore += 15;
      }
    }

    // Market Structure Analysis (10 points)
    if (trendIndicators.marketStructure) {
      const ms = trendIndicators.marketStructure;
      details.marketStructure = ms;
      
      if (ms.trend === 'BULLISH' && ms.strength > 0.6) {
        longScore += 10;
      } else if (ms.trend === 'BEARISH' && ms.strength > 0.6) {
        shortScore += 10;
      }
    }

    return {
      longScore,
      shortScore,
      weight,
      details
    };
  }

  analyzeMomentum(momentumIndicators) {
    let longScore = 0;
    let shortScore = 0;
    const weight = 25;
    const details = {};

    // MFI Analysis (10 points)
    if (momentumIndicators.mfi) {
      const mfi = momentumIndicators.mfi;
      details.mfi = { value: mfi.toFixed(2) };
      
      if (mfi < config.indicators.mfi.oversold) {
        longScore += 10;
        details.mfi.status = 'OVERSOLD';
      } else if (mfi > config.indicators.mfi.overbought) {
        shortScore += 10;
        details.mfi.status = 'OVERBOUGHT';
      } else if (mfi < 40) {
        longScore += 5;
        details.mfi.status = 'BEARISH';
      } else if (mfi > 60) {
        shortScore += 5;
        details.mfi.status = 'BULLISH';
      } else {
        details.mfi.status = 'NEUTRAL';
      }
    }

    // Williams %R Analysis (8 points)
    if (momentumIndicators.williamsR) {
      const wr = momentumIndicators.williamsR;
      details.williamsR = { value: wr.toFixed(2) };
      
      if (wr < config.indicators.williamsR.oversold) {
        longScore += 8;
        details.williamsR.status = 'OVERSOLD';
      } else if (wr > config.indicators.williamsR.overbought) {
        shortScore += 8;
        details.williamsR.status = 'OVERBOUGHT';
      } else {
        details.williamsR.status = 'NEUTRAL';
      }
    }

    // CCI Analysis (7 points)
    if (momentumIndicators.cci) {
      const cci = momentumIndicators.cci;
      details.cci = { value: cci.toFixed(2) };
      
      if (cci < config.indicators.cci.oversold) {
        longScore += 7;
        details.cci.status = 'OVERSOLD';
      } else if (cci > config.indicators.cci.overbought) {
        shortScore += 7;
        details.cci.status = 'OVERBOUGHT';
      } else {
        details.cci.status = 'NEUTRAL';
      }
    }

    return {
      longScore,
      shortScore,
      weight,
      details
    };
  }

  analyzeVolume(price, volumeIndicators) {
    let longScore = 0;
    let shortScore = 0;
    const weight = 20;
    const details = {};

    // VWAP Analysis (20 points)
    if (volumeIndicators.vwap) {
      const vwap = volumeIndicators.vwap;
      const diff = ((price - vwap) / vwap) * 100;
      
      details.vwap = {
        value: vwap.toFixed(6),
        difference: diff.toFixed(3)
      };
      
      if (diff > 0.3) {
        longScore += 20;
        details.vwap.status = 'STRONG_ABOVE';
      } else if (diff > 0.1) {
        longScore += 15;
        details.vwap.status = 'ABOVE';
      } else if (diff < -0.3) {
        shortScore += 20;
        details.vwap.status = 'STRONG_BELOW';
      } else if (diff < -0.1) {
        shortScore += 15;
        details.vwap.status = 'BELOW';
      } else {
        details.vwap.status = 'NEAR';
      }
    }

    // OBV Analysis (additional context)
    if (volumeIndicators.obv) {
      details.obv = {
        value: volumeIndicators.obv > 0 ? 'POSITIVE' : 'NEGATIVE',
        trend: volumeIndicators.obv > 0 ? 'BULLISH' : 'BEARISH'
      };
    }

    return {
      longScore,
      shortScore,
      weight,
      details
    };
  }

  analyzeFuturesData(futuresIndicators) {
    let longScore = 0;
    let shortScore = 0;
    const weight = 15;
    const details = {};

    // Funding Rate Analysis (10 points)
    if (futuresIndicators.fundingRate) {
      const fr = futuresIndicators.fundingRate;
      details.fundingRate = {
        value: (fr * 100).toFixed(4),
        annualized: (fr * 100 * 365).toFixed(2)
      };
      
      if (fr > config.futures.fundingRate.extremeThreshold) {
        shortScore += 10; // High positive funding is bearish
        details.fundingRate.bias = 'BEARISH';
      } else if (fr < -config.futures.fundingRate.extremeThreshold) {
        longScore += 10; // High negative funding is bullish
        details.fundingRate.bias = 'BULLISH';
      } else if (fr > 0.005) {
        shortScore += 5;
        details.fundingRate.bias = 'SLIGHTLY_BEARISH';
      } else if (fr < -0.005) {
        longScore += 5;
        details.fundingRate.bias = 'SLIGHTLY_BULLISH';
      } else {
        details.fundingRate.bias = 'NEUTRAL';
      }
    }

    // Liquidation Analysis (5 points)
    if (futuresIndicators.liquidationData && futuresIndicators.liquidationData.liquidationRatio !== undefined) {
      const liq = futuresIndicators.liquidationData;
      details.liquidations = {
        ratio: liq.liquidationRatio.toFixed(3),
        totalValue: liq.totalValue ? (liq.totalValue / 1000000).toFixed(2) + 'M' : 'N/A'
      };
      
      if (liq.liquidationRatio > 0.75) {
        longScore += 5; // More longs liquidated = oversold
        details.liquidations.bias = 'BULLISH';
      } else if (liq.liquidationRatio < 0.25) {
        shortScore += 5; // More shorts liquidated = overbought
        details.liquidations.bias = 'BEARISH';
      } else {
        details.liquidations.bias = 'NEUTRAL';
      }
    }

    return {
      longScore,
      shortScore,
      weight,
      details
    };
  }

  getEMAAlignment(trendIndicators) {
    const { ema8, ema21, ema50 } = trendIndicators;
    
    if (ema8 > ema21 && ema21 > ema50) {
      return ema8 > ema21 * 1.005 ? 'STRONG_BULL' : 'BULL';
    } else if (ema8 < ema21 && ema21 < ema50) {
      return ema8 < ema21 * 0.995 ? 'STRONG_BEAR' : 'BEAR';
    } else if (ema8 > ema21) {
      return 'WEAK_BULL';
    } else if (ema8 < ema21) {
      return 'WEAK_BEAR';
    }
    
    return 'NEUTRAL';
  }

  calculateRiskParameters(currentPrice, signal, indicators) {
    try {
      const atr = indicators.risk.atr;
      const supportResistance = indicators.risk.supportResistance;
      
      const entryPrice = riskManagement.calculateEntryPrice(currentPrice, signal, indicators, atr);
      const takeProfits = riskManagement.calculateTakeProfitLevels(entryPrice, signal, indicators, atr, supportResistance);
      const stopLoss = riskManagement.calculateStopLoss(entryPrice, signal, indicators, atr, supportResistance);
      
      if (!takeProfits || !stopLoss) {
        return null;
      }

      const riskRewards = riskManagement.calculateRiskReward(entryPrice, stopLoss, [takeProfits.tp1, takeProfits.tp2, takeProfits.tp3]);
      
      // Check minimum risk/reward requirement
      if (!riskRewards || riskRewards[0] < config.riskManagement.minRiskReward) {
        return null;
      }

      const positionInfo = riskManagement.calculatePositionSize(
        config.riskManagement.defaultAccountBalance,
        config.riskManagement.defaultRiskPercentage,
        entryPrice,
        stopLoss,
        config.riskManagement.maxLeverage
      );

      return {
        entryPrice,
        takeProfits,
        stopLoss,
        riskRewards,
        positionInfo
      };
    } catch (error) {
      logger.error(`Risk parameters calculation error: ${error.message}`);
      return null;
    }
  }

  clearCache() {
    this.signalCache.clear();
    logger.info('Technical analysis cache cleared');
  }
}

module.exports = new FuturesTechnicalAnalysis();
