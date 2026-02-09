import { useState, useRef, useEffect } from 'react';
import { Send, TrendingUp, TrendingDown, Bot, User, Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/lib/utils';
import { investmentAdvisorApi } from '@/lib/api';
import type { Investment } from '@/types';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: Date;
}

interface InvestmentAdvisorChatProps {
  investments: Investment[];
  liveQuotes?: Record<string, {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
  }>;
  exchangeRate?: number;
}

export function InvestmentAdvisorChat({
  investments,
  liveQuotes = {},
  exchangeRate = 83.5,
}: InvestmentAdvisorChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Calculate gainers and losers for display
  const calculatePerformance = () => {
    const withPerformance = investments.map((inv) => {
      const invested = inv.purchasePrice * inv.quantity;

      // Use live quote if available for US stocks
      let current = inv.currentValue || invested;
      if (inv.symbol && liveQuotes[inv.symbol]) {
        current = liveQuotes[inv.symbol].price * inv.quantity;
      }

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

    const sorted = [...withPerformance].sort((a, b) => b.gainPercent - a.gainPercent);
    const gainers = sorted.filter(i => i.gainPercent > 0).slice(0, 2);
    const losers = sorted.filter(i => i.gainPercent < 0).slice(-2).reverse();

    return { gainers, losers, all: withPerformance };
  };

  const { gainers, losers, all } = calculatePerformance();

  // Build portfolio data for API
  const buildPortfolioData = () => {
    return investments.map((inv) => {
      let currentPrice: number | undefined = inv.currentPrice ?? undefined;
      let currentValue: number | undefined = inv.currentValue ?? undefined;

      // Use live quote if available
      if (inv.symbol && liveQuotes[inv.symbol]) {
        currentPrice = liveQuotes[inv.symbol].price;
        currentValue = currentPrice * inv.quantity;
      }

      return {
        name: inv.name,
        symbol: inv.symbol || undefined,
        type: inv.type,
        country: (inv.country || 'IN') as 'IN' | 'US',
        quantity: inv.quantity,
        purchasePrice: inv.purchasePrice,
        currentPrice,
        currentValue,
        purchaseDate: inv.purchaseDate,
        platform: inv.platform || undefined,
      };
    });
  };

  // Generate fallback local analysis
  const generateLocalAnalysis = () => {
    const indiaHoldings = all.filter(i => (i.country || 'IN') === 'IN');
    const usHoldings = all.filter(i => i.country === 'US');

    const totalInvested = all.reduce((sum, i) => {
      const amount = i.invested;
      return sum + (i.country === 'US' ? amount * exchangeRate : amount);
    }, 0);

    const totalCurrent = all.reduce((sum, i) => {
      const amount = i.current;
      return sum + (i.country === 'US' ? amount * exchangeRate : amount);
    }, 0);

    const totalGain = totalCurrent - totalInvested;
    const totalGainPercent = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

    let message = `## Portfolio Overview\n\n`;
    message += `**Total Portfolio Value:** ${formatCurrency(totalCurrent)}\n`;
    message += `**Overall Return:** ${totalGainPercent >= 0 ? '+' : ''}${totalGainPercent.toFixed(2)}%\n\n`;
    message += `**Holdings:** ${indiaHoldings.length} India | ${usHoldings.length} US\n\n`;

    if (gainers.length > 0) {
      message += `### Top Gainers\n`;
      gainers.forEach((g, i) => {
        const currency = g.country === 'US' ? 'USD' : 'INR';
        message += `${i + 1}. **${g.name}** ${g.symbol ? `(${g.symbol})` : ''}\n`;
        message += `   +${g.gainPercent.toFixed(2)}% | ${formatCurrency(g.gain, currency)}\n`;
      });
      message += `\n`;
    }

    if (losers.length > 0) {
      message += `### Top Losers\n`;
      losers.forEach((l, i) => {
        const currency = l.country === 'US' ? 'USD' : 'INR';
        message += `${i + 1}. **${l.name}** ${l.symbol ? `(${l.symbol})` : ''}\n`;
        message += `   ${l.gainPercent.toFixed(2)}% | ${formatCurrency(l.gain, currency)}\n`;
      });
      message += `\n`;
    }

    message += `---\n\n*AI advisor not configured. Using local analysis.*\n\n`;
    message += `Ask me about: diversification, growth 2026, risk, gainers, losers`;

    return message;
  };

  // Generate initial analysis
  useEffect(() => {
    if (investments.length > 0 && messages.length === 0 && !isInitializing) {
      setIsInitializing(true);

      const fetchAnalysis = async () => {
        try {
          const portfolio = buildPortfolioData();
          const result = await investmentAdvisorApi.analyze({
            portfolio,
            exchangeRate,
          });

          setMessages([{
            id: '1',
            role: 'assistant',
            content: result.message,
            timestamp: new Date(),
          }]);
        } catch (error) {
          console.error('Failed to get AI analysis, using local fallback:', error);
          // Use local analysis as fallback
          setMessages([{
            id: '1',
            role: 'assistant',
            content: generateLocalAnalysis(),
            timestamp: new Date(),
          }]);
        } finally {
          setIsInitializing(false);
        }
      };

      fetchAnalysis();
    }
  }, [investments, messages.length]);

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history (excluding initial analysis)
      const conversationHistory = messages.slice(1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const portfolio = buildPortfolioData();
      const result = await investmentAdvisorApi.chat({
        message: input,
        portfolio,
        conversationHistory,
        exchangeRate,
      });

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.message,
        timestamp: new Date(),
      }]);
    } catch (error) {
      console.error('Failed to get AI response:', error);
      // Fallback to local response
      const response = generateLocalResponse(input.toLowerCase());
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Local fallback response generator
  const generateLocalResponse = (query: string): string => {
    const indiaHoldings = all.filter(i => (i.country || 'IN') === 'IN');
    const usHoldings = all.filter(i => i.country === 'US');

    const totalCurrentINR = all.reduce((sum, i) => {
      const amount = i.current;
      return sum + (i.country === 'US' ? amount * exchangeRate : amount);
    }, 0);

    // Diversification query
    if (query.includes('diversif') || query.includes('allocation') || query.includes('sector')) {
      const typeBreakdown = all.reduce((acc, inv) => {
        acc[inv.type] = (acc[inv.type] || 0) + (inv.country === 'US' ? inv.current * exchangeRate : inv.current);
        return acc;
      }, {} as Record<string, number>);

      let response = `## Portfolio Allocation\n\n`;
      response += `**Geographic Split:**\n`;
      const indiaValue = indiaHoldings.reduce((s, i) => s + i.current, 0);
      const usValueINR = usHoldings.reduce((s, i) => s + i.current, 0) * exchangeRate;
      response += `- India: ${((indiaValue / totalCurrentINR) * 100).toFixed(1)}%\n`;
      response += `- US: ${((usValueINR / totalCurrentINR) * 100).toFixed(1)}%\n\n`;

      response += `**By Type:**\n`;
      Object.entries(typeBreakdown).forEach(([type, value]) => {
        response += `- ${type}: ${(((value as number) / totalCurrentINR) * 100).toFixed(1)}%\n`;
      });

      response += `\n*AI advisor not configured. Using local analysis.*`;
      return response;
    }

    // Growth/2026 query
    if (query.includes('growth') || query.includes('2026') || query.includes('recommend')) {
      let response = `## Growth Strategy for 2026\n\n`;

      if (gainers.length > 0) {
        response += `**Winners to Watch:**\n`;
        gainers.forEach(g => {
          response += `- **${g.name}**: +${g.gainPercent.toFixed(1)}%\n`;
        });
        response += `\n`;
      }

      if (losers.length > 0) {
        response += `**Review These:**\n`;
        losers.forEach(l => {
          response += `- **${l.name}**: ${l.gainPercent.toFixed(1)}%\n`;
        });
      }

      response += `\n*AI advisor not configured. Using local analysis.*`;
      return response;
    }

    // Risk query
    if (query.includes('risk')) {
      const volatileCount = all.filter(i => i.type === 'crypto' || i.type === 'stocks').length;
      const riskScore = (volatileCount / Math.max(all.length, 1)) * 100;

      let response = `## Risk Assessment\n\n`;
      response += `**Risk Score:** ${riskScore.toFixed(0)}/100\n`;
      response += `**Profile:** ${riskScore > 70 ? 'Aggressive' : riskScore > 40 ? 'Moderate' : 'Conservative'}\n\n`;
      response += `*AI advisor not configured. Using local analysis.*`;
      return response;
    }

    // Gainers/Losers
    if (query.includes('gainer') || query.includes('winner') || query.includes('top')) {
      if (gainers.length === 0) return `No gains currently in your portfolio.`;

      let response = `## Top Gainers\n\n`;
      gainers.forEach((g, i) => {
        response += `${i + 1}. **${g.name}** +${g.gainPercent.toFixed(2)}%\n`;
      });
      return response;
    }

    if (query.includes('loser') || query.includes('worst') || query.includes('down')) {
      if (losers.length === 0) return `Great! No losses in your portfolio.`;

      let response = `## Underperformers\n\n`;
      losers.forEach((l, i) => {
        response += `${i + 1}. **${l.name}** ${l.gainPercent.toFixed(2)}%\n`;
      });
      return response;
    }

    return `I can help with:\n- **diversification** - Allocation analysis\n- **growth 2026** - Recommendations\n- **risk** - Risk assessment\n- **gainers/losers** - Performance review\n\n*AI advisor not configured. Using local analysis.*`;
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 border-b">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Investment Advisor
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Quick Stats */}
        <div className="p-3 border-b bg-muted/30">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-muted-foreground">Gainers:</span>
              <span className="font-medium text-green-500">{gainers.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span className="text-muted-foreground">Losers:</span>
              <span className="font-medium text-red-500">{losers.length}</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-3" ref={scrollRef}>
          <div className="space-y-4">
            {isInitializing && messages.length === 0 && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
                </div>
                <div className="bg-muted rounded-lg p-2">
                  <span className="text-xs text-muted-foreground">Analyzing your portfolio...</span>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Bot className="h-3 w-3 text-amber-500" />
                  </div>
                )}
                <div
                  className={`max-w-[90%] rounded-lg p-2 text-xs ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <div className="whitespace-pre-wrap prose prose-xs dark:prose-invert max-w-none">
                    {message.content.split('\n').map((line, i) => {
                      if (line.startsWith('## ')) {
                        return <h3 key={i} className="text-sm font-semibold mt-2 mb-1">{line.replace('## ', '')}</h3>;
                      }
                      if (line.startsWith('### ')) {
                        return <h4 key={i} className="text-xs font-semibold mt-2 mb-1">{line.replace('### ', '')}</h4>;
                      }
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <p key={i} className="font-semibold">{line.replace(/\*\*/g, '')}</p>;
                      }
                      if (line.startsWith('- ')) {
                        return <p key={i} className="ml-2">{line}</p>;
                      }
                      if (line === '---') {
                        return <hr key={i} className="my-2 border-border" />;
                      }
                      return <p key={i}>{line}</p>;
                    })}
                  </div>
                </div>
                {message.role === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-3 w-3" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
                </div>
                <div className="bg-muted rounded-lg p-2">
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about your portfolio..."
              className="text-xs h-8"
              disabled={isLoading || isInitializing}
            />
            <Button
              size="sm"
              className="h-8 px-2"
              onClick={handleSend}
              disabled={!input.trim() || isLoading || isInitializing}
            >
              <Send className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-1 mt-2 flex-wrap">
            {['diversification', 'growth 2026', 'risk', 'gainers'].map((q) => (
              <Badge
                key={q}
                variant="outline"
                className="text-[10px] cursor-pointer hover:bg-muted"
                onClick={() => {
                  setInput(q);
                }}
              >
                {q}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
