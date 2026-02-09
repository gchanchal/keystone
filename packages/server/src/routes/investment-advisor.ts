import { Router } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface PortfolioHolding {
  name: string;
  symbol?: string;
  type: string;
  country: 'IN' | 'US';
  quantity: number;
  purchasePrice: number;
  currentPrice?: number;
  currentValue?: number;
  purchaseDate: string;
  platform?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Investment Advisor Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { message, portfolio, conversationHistory, exchangeRate } = z
      .object({
        message: z.string(),
        portfolio: z.array(z.object({
          name: z.string(),
          symbol: z.string().optional(),
          type: z.string(),
          country: z.enum(['IN', 'US']),
          quantity: z.number(),
          purchasePrice: z.number(),
          currentPrice: z.number().optional(),
          currentValue: z.number().optional(),
          purchaseDate: z.string(),
          platform: z.string().optional(),
        })),
        conversationHistory: z.array(z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })).optional(),
        exchangeRate: z.number().default(83.5),
      })
      .parse(req.body);

    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'AI advisor not configured',
        fallback: true,
        message: 'ANTHROPIC_API_KEY not set. Using local analysis.'
      });
    }

    // Calculate portfolio metrics
    const portfolioMetrics = calculatePortfolioMetrics(portfolio, exchangeRate);

    // Build system prompt
    const systemPrompt = buildSystemPrompt(portfolioMetrics, exchangeRate);

    // Build conversation messages
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory.slice(-10)); // Keep last 10 messages for context
    }

    messages.push({ role: 'user', content: message });

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const assistantMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : 'I apologize, I could not generate a response.';

    res.json({
      message: assistantMessage,
      metrics: portfolioMetrics,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error in investment advisor chat:', error);
    res.status(500).json({
      error: 'Failed to get advisor response',
      fallback: true,
    });
  }
});

// Get initial portfolio analysis
router.post('/analyze', async (req, res) => {
  try {
    const { portfolio, exchangeRate } = z
      .object({
        portfolio: z.array(z.object({
          name: z.string(),
          symbol: z.string().optional(),
          type: z.string(),
          country: z.enum(['IN', 'US']),
          quantity: z.number(),
          purchasePrice: z.number(),
          currentPrice: z.number().optional(),
          currentValue: z.number().optional(),
          purchaseDate: z.string(),
          platform: z.string().optional(),
        })),
        exchangeRate: z.number().default(83.5),
      })
      .parse(req.body);

    // Check if API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      const metrics = calculatePortfolioMetrics(portfolio, exchangeRate);
      return res.json({
        fallback: true,
        metrics,
        message: generateLocalAnalysis(metrics),
      });
    }

    const metrics = calculatePortfolioMetrics(portfolio, exchangeRate);
    const systemPrompt = buildSystemPrompt(metrics, exchangeRate);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Please provide an initial analysis of my portfolio. Include:
1. A brief overview of my portfolio composition
2. My top 2 performing investments (gainers)
3. My 2 weakest performing investments (losers)
4. One key recommendation for portfolio improvement
5. A brief outlook for 2026

Keep the response concise and actionable. Use bullet points and clear formatting.`
      }],
    });

    const assistantMessage = response.content[0].type === 'text'
      ? response.content[0].text
      : 'Unable to generate analysis.';

    res.json({
      message: assistantMessage,
      metrics,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error in portfolio analysis:', error);

    // Fallback to local analysis
    try {
      const { portfolio, exchangeRate = 83.5 } = req.body;
      const metrics = calculatePortfolioMetrics(portfolio, exchangeRate);
      res.json({
        fallback: true,
        metrics,
        message: generateLocalAnalysis(metrics),
      });
    } catch {
      res.status(500).json({ error: 'Failed to analyze portfolio' });
    }
  }
});

// Helper functions
function calculatePortfolioMetrics(portfolio: PortfolioHolding[], exchangeRate: number) {
  const holdings = portfolio.map((inv) => {
    const invested = inv.purchasePrice * inv.quantity;
    const current = inv.currentValue || (inv.currentPrice ? inv.currentPrice * inv.quantity : invested);
    const gain = current - invested;
    const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;

    return {
      ...inv,
      invested,
      current,
      gain,
      gainPercent,
    };
  });

  const indiaHoldings = holdings.filter(h => (h.country || 'IN') === 'IN');
  const usHoldings = holdings.filter(h => h.country === 'US');

  const totalInvestedINR = holdings.reduce((sum, h) => {
    return sum + (h.country === 'US' ? h.invested * exchangeRate : h.invested);
  }, 0);

  const totalCurrentINR = holdings.reduce((sum, h) => {
    return sum + (h.country === 'US' ? h.current * exchangeRate : h.current);
  }, 0);

  const totalGain = totalCurrentINR - totalInvestedINR;
  const totalGainPercent = totalInvestedINR > 0 ? (totalGain / totalInvestedINR) * 100 : 0;

  // Sort by performance
  const sorted = [...holdings].sort((a, b) => b.gainPercent - a.gainPercent);
  const gainers = sorted.filter(h => h.gainPercent > 0).slice(0, 3);
  const losers = sorted.filter(h => h.gainPercent < 0).slice(-3).reverse();

  // Type breakdown
  const typeBreakdown: Record<string, number> = {};
  holdings.forEach(h => {
    const value = h.country === 'US' ? h.current * exchangeRate : h.current;
    typeBreakdown[h.type] = (typeBreakdown[h.type] || 0) + value;
  });

  // Geographic breakdown
  const indiaValue = indiaHoldings.reduce((s, h) => s + h.current, 0);
  const usValueINR = usHoldings.reduce((s, h) => s + h.current, 0) * exchangeRate;

  return {
    totalInvested: totalInvestedINR,
    totalCurrent: totalCurrentINR,
    totalGain,
    totalGainPercent,
    holdingsCount: holdings.length,
    indiaCount: indiaHoldings.length,
    usCount: usHoldings.length,
    indiaAllocation: totalCurrentINR > 0 ? (indiaValue / totalCurrentINR) * 100 : 0,
    usAllocation: totalCurrentINR > 0 ? (usValueINR / totalCurrentINR) * 100 : 0,
    typeBreakdown,
    gainers,
    losers,
    holdings,
  };
}

function buildSystemPrompt(metrics: ReturnType<typeof calculatePortfolioMetrics>, exchangeRate: number): string {
  const formatCurrency = (amount: number, currency: string = 'INR') => {
    if (currency === 'USD') {
      return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  let portfolioContext = `You are an expert financial advisor helping analyze an investment portfolio. Today's date is ${new Date().toISOString().split('T')[0]}.

PORTFOLIO OVERVIEW:
- Total Invested: ${formatCurrency(metrics.totalInvested)}
- Current Value: ${formatCurrency(metrics.totalCurrent)}
- Overall Return: ${metrics.totalGainPercent >= 0 ? '+' : ''}${metrics.totalGainPercent.toFixed(2)}%
- USD/INR Exchange Rate: ${exchangeRate}

HOLDINGS BREAKDOWN:
- Total Holdings: ${metrics.holdingsCount}
- India Holdings: ${metrics.indiaCount} (${metrics.indiaAllocation.toFixed(1)}% of portfolio)
- US Holdings: ${metrics.usCount} (${metrics.usAllocation.toFixed(1)}% of portfolio)

TYPE ALLOCATION:
${Object.entries(metrics.typeBreakdown).map(([type, value]) =>
  `- ${type}: ${formatCurrency(value)} (${((value / metrics.totalCurrent) * 100).toFixed(1)}%)`
).join('\n')}

TOP PERFORMERS:
${metrics.gainers.map((g, i) =>
  `${i + 1}. ${g.name}${g.symbol ? ` (${g.symbol})` : ''} - ${g.country}
   Invested: ${formatCurrency(g.invested, g.country === 'US' ? 'USD' : 'INR')}
   Current: ${formatCurrency(g.current, g.country === 'US' ? 'USD' : 'INR')}
   Return: +${g.gainPercent.toFixed(2)}%`
).join('\n') || 'No gainers'}

UNDERPERFORMERS:
${metrics.losers.map((l, i) =>
  `${i + 1}. ${l.name}${l.symbol ? ` (${l.symbol})` : ''} - ${l.country}
   Invested: ${formatCurrency(l.invested, l.country === 'US' ? 'USD' : 'INR')}
   Current: ${formatCurrency(l.current, l.country === 'US' ? 'USD' : 'INR')}
   Return: ${l.gainPercent.toFixed(2)}%`
).join('\n') || 'No losers'}

DETAILED HOLDINGS:
${metrics.holdings.map(h =>
  `- ${h.name}${h.symbol ? ` (${h.symbol})` : ''}: ${h.type}, ${h.country}, ${h.gainPercent >= 0 ? '+' : ''}${h.gainPercent.toFixed(2)}%`
).join('\n')}

GUIDELINES:
1. Provide specific, actionable advice based on the actual portfolio data
2. Consider both Indian and US market perspectives
3. Be concise but thorough - use bullet points and clear structure
4. When discussing specific stocks, reference their actual performance from the data
5. Consider current market conditions (2026) in your recommendations
6. Always disclaimer that this is general guidance, not personalized financial advice
7. Format responses with markdown for better readability
8. Keep responses focused and under 400 words unless asked for detailed analysis`;

  return portfolioContext;
}

function generateLocalAnalysis(metrics: ReturnType<typeof calculatePortfolioMetrics>): string {
  const formatCurrency = (amount: number, currency: string = 'INR') => {
    if (currency === 'USD') {
      return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    }
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  let analysis = `## Portfolio Overview\n\n`;
  analysis += `**Total Value:** ${formatCurrency(metrics.totalCurrent)}\n`;
  analysis += `**Overall Return:** ${metrics.totalGainPercent >= 0 ? '+' : ''}${metrics.totalGainPercent.toFixed(2)}%\n\n`;
  analysis += `**Holdings:** ${metrics.indiaCount} India | ${metrics.usCount} US\n\n`;

  if (metrics.gainers.length > 0) {
    analysis += `### Top Gainers\n`;
    metrics.gainers.forEach((g, i) => {
      analysis += `${i + 1}. **${g.name}** +${g.gainPercent.toFixed(2)}%\n`;
    });
    analysis += `\n`;
  }

  if (metrics.losers.length > 0) {
    analysis += `### Top Losers\n`;
    metrics.losers.forEach((l, i) => {
      analysis += `${i + 1}. **${l.name}** ${l.gainPercent.toFixed(2)}%\n`;
    });
    analysis += `\n`;
  }

  analysis += `---\n\n*AI advisor not configured. Add ANTHROPIC_API_KEY for detailed analysis.*\n\n`;
  analysis += `Ask me about: diversification, risk, growth 2026, gainers, losers`;

  return analysis;
}

export default router;
