const { RSI, MACD, BollingerBands, Stochastic } = require('technicalindicators');
const config = require('../config/config');
const logger = require('../utils/logger');

class TechnicalAnalysis {
  calculateRSI(closes) {
    try {
      const rsi = RSI.calculate({
        values: closes,
        period: config.indicators.rsi.period
      });
      return rsi.length > 0 ? rsi[rsi.length - 1] : null;
    } catch (error) {
      logger.error(`RSI calculation error: ${error.message}`);
      return null;
    }
  }

  calculateMACD(closes) {
    try {
      const macd = MACD.calculate({
        values: closes,
        fastPeriod: config.indicators.macd.fastPeriod,
        slowPeriod: config.indicators.macd.slowPeriod,
        signalPeriod: config.indicators.macd.signalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
      
      if (macd.length === 0) return null;
      
      const latest = macd[macd.length - 1];
      return {
        macd: latest.MACD,
        signal: latest.signal,
        histogram: latest.histogram
      };
    } catch (error) {
      logger.error(`MACD calculation error: ${error.message}`);
      return null;
    }
  }

  calculateBollingerBands(closes) {
    try {
      const bb = BollingerBands.calculate({
        values: closes,
        period: config.indicators.bollinger.period,
        stdDev: config.indicators.bollinger.stdDev
      });
      
      if (bb.length === 0) return null;
      
      const latest = bb[bb.length - 1];
      return {
        upper: latest.upper,
        middle: latest.middle,
        lower: latest.lower
      };
    } catch (error) {
      logger.error(`Bollinger Bands calculation error: ${error.message}`);
      return null;
    }
  }

  calculateStochastic(highs, lows, closes) {
    try {
      const stoch = Stochastic.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: config.indicators.stochastic.kPeriod,
        signalPeriod: config.indicators.stochastic.dPeriod
      });
      
      if (stoch.length === 0) return null;
      
      const latest = stoch[stoch.length - 1];
      return {
        k: latest.k,
        d: latest.d
      };
    } catch (error) {
      logger.error(`Stochastic calculation error: ${error.message}`);
      return null;
    }
  }

  calculatePivotPoints(ohlcv) {
    try {
      if (ohlcv.length < 2) return null;
      
      const yesterday = ohlcv[ohlcv.length - 2];
      const high = yesterday.high;
      const low = yesterday.low;
      const close = yesterday.close;
      
      const pivot = (high + low + close) / 3;
      const r1 = 2 * pivot - low;
      const s1 = 2 * pivot - high;
      const r2 = pivot + (high - low);
      const s2 = pivot - (high - low);
      const r3 = high + 2 * (pivot - low);
      const s3 = low - 2 * (high - pivot);
      
      return {
        pivot,
        r1, r2, r3,
        s1, s2, s3
      };
    } catch (error) {
      logger.error(`Pivot Points calculation error: ${error.message}`);
      return null;
    }
  }

  async analyzeToken(symbol, ohlcv) {
    try {
      if (!ohlcv || ohlcv.length < 50) {
        return null;
      }

      const closes = ohlcv.map(candle => candle.close);
      const highs = ohlcv.map(candle => candle.high);
      const lows = ohlcv.map(candle => candle.low);
      const currentPrice = closes[closes.length - 1];

      // Calculate all indicators
      const rsi = this.calculateRSI(closes);
      const macd = this.calculateMACD(closes);
      const bollinger = this.calculateBollingerBands(closes);
      const stochastic = this.calculateStochastic(highs, lows, closes);
      const pivot = this.calculatePivotPoints(ohlcv);

      if (!rsi || !macd || !bollinger || !stochastic || !pivot) {
        return null;
      }

      const indicators = {
        rsi,
        macd,
        bollinger,
        stochastic,
        pivot
      };

      // Generate signal
      const signal = this.generateSignal(currentPrice, indicators);

      return {
        symbol,
        price: currentPrice,
        timestamp: new Date(),
        indicators,
        signal
      };
    } catch (error) {
      logger.error(`Analysis error for ${symbol}: ${error.message}`);
      return null;
    }
  }

  generateSignal(price, indicators) {
    let longScore = 0;
    let shortScore = 0;
    let totalWeight = 0;

    // RSI Analysis
    const rsiWeight = config.indicators.rsi.weight;
    if (indicators.rsi < config.indicators.rsi.oversold) {
      longScore += rsiWeight;
    } else if (indicators.rsi > config.indicators.rsi.overbought) {
      shortScore += rsiWeight;
    }
    totalWeight += rsiWeight;

    // MACD Analysis
    const macdWeight = config.indicators.macd.weight;
    if (indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0) {
      longScore += macdWeight;
    } else if (indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0) {
      shortScore += macdWeight;
    }
    totalWeight += macdWeight;

    // Bollinger Bands Analysis
    const bbWeight = config.indicators.bollinger.weight;
    if (price < indicators.bollinger.lower) {
      longScore += bbWeight;
    } else if (price > indicators.bollinger.upper) {
      shortScore += bbWeight;
    }
    totalWeight += bbWeight;

    // Stochastic Analysis
    const stochWeight = config.indicators.stochastic.weight;
    if (indicators.stochastic.k < 20 && indicators.stochastic.d < 20) {
      longScore += stochWeight;
    } else if (indicators.stochastic.k > 80 && indicators.stochastic.d > 80) {
      shortScore += stochWeight;
    }
    totalWeight += stochWeight;

    // Pivot Points Analysis
    const pivotWeight = config.indicators.pivot.weight;
    if (price < indicators.pivot.s1 && price > indicators.pivot.s2) {
      longScore += pivotWeight;
    } else if (price > indicators.pivot.r1 && price < indicators.pivot.r2) {
      shortScore += pivotWeight;
    }
    totalWeight += pivotWeight;

    // Calculate percentages
    const longStrength = (longScore / totalWeight) * 100;
    const shortStrength = (shortScore / totalWeight) * 100;

    // Generate signal
    if (longStrength >= config.signal.minConfidence) {
      return {
        direction: 'LONG',
        strength: longStrength,
        confidence: longStrength >= config.signal.highConfidence ? 'HIGH' : 'MEDIUM'
      };
    } else if (shortStrength >= config.signal.minConfidence) {
      return {
        direction: 'SHORT',
        strength: shortStrength,
        confidence: shortStrength >= config.signal.highConfidence ? 'HIGH' : 'MEDIUM'
      };
    }

    return null;
  }
}

module.exports = new TechnicalAnalysis();
