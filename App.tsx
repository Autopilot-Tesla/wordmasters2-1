import React, { useState, useEffect } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { ServerList } from './components/ServerList';
import { ChannelList } from './components/ChannelList';
import { ChatArea } from './components/ChatArea';
import { UserList } from './components/UserList';
import { User, Channel, Message, Server, Category } from './types';
import { INITIAL_SERVERS, INITIAL_CHANNELS, INITIAL_MESSAGES, CATEGORIES as INITIAL_CATEGORIES } from './constants';
import { generateAIResponse } from './services/geminiService';
import * as DiscordService from './services/discordService';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [discordToken, setDiscordToken] = useState<string>('');
  const [proxyUrl, setProxyUrl] = useState<string>('');
  
  const [servers, setServers] = useState<Server[]>(INITIAL_SERVERS);
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS);
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  
  const [activeServerId, setActiveServerId] = useState<string>(INITIAL_SERVERS[0].id);
  const [activeChannelId, setActiveChannelId] = useState<string>(INITIAL_CHANNELS[0].id);
  const [messages, setMessages] = useState<Record<string, Message[]>>(INITIAL_MESSAGES);
  
  const [isLoading, setIsLoading] = useState(false);
  const [voiceConnected, setVoiceConnected] = useState(false);

  // Load state
  useEffect(() => {
    const storedUser = localStorage.getItem('discord_ai_user');
    const storedToken = localStorage.getItem('discord_token');
    const storedProxy = localStorage.getItem('discord_proxy');

    if (storedUser) setUser(JSON.parse(storedUser));
    if (storedToken) setDiscordToken(storedToken);
    if (storedProxy) setProxyUrl(storedProxy);
  }, []);

  // Fetch real discord data when server changes
  useEffect(() => {
    const activeServer = servers.find(s => s.id === activeServerId);
    
    const loadRealData = async () => {
      if (activeServer?.isReal && discordToken) {
        setIsLoading(true);
        try {
          const { channels: realChannels, categories: realCategories } = await DiscordService.fetchChannels(activeServerId, discordToken, proxyUrl);
          setChannels(realChannels);
          setCategories(realCategories);
          if (realChannels.length > 0) setActiveChannelId(realChannels[0].id);
        } catch (e) {
          console.error("Failed to load guild data", e);
        } finally {
          setIsLoading(false);
        }
      } else if (!activeServer?.isReal) {
        // Reset to AI Data
        setChannels(INITIAL_CHANNELS);
        setCategories(INITIAL_CATEGORIES);
        if (!INITIAL_CHANNELS.find(c => c.id === activeChannelId)) {
             setActiveChannelId(INITIAL_CHANNELS[0].id);
        }
      }
    };

    loadRealData();
  }, [activeServerId, servers, discordToken, proxyUrl]);

  // Fetch real messages when channel changes
  useEffect(() => {
    const activeServer = servers.find(s => s.id === activeServerId);
    
    if (activeServer?.isReal && discordToken && activeChannelId) {
       const loadMessages = async () => {
         setIsLoading(true);
         try {
           const msgs = await DiscordService.fetchMessages(activeChannelId, discordToken, proxyUrl);
           setMessages(prev => ({ ...prev, [activeChannelId]: msgs }));
         } catch (e) {
           console.error("Failed to fetch messages", e);
         } finally {
           setIsLoading(false);
         }
       };
       loadMessages();
       // Poll for new messages every 5 seconds if real
       const interval = setInterval(loadMessages, 5000);
       return () => clearInterval(interval);
    }
  }, [activeChannelId, activeServerId, discordToken, proxyUrl]);


  const handleLogin = async (username: string, token?: string, proxy?: string) => {
    if (token) {
       try {
         setIsLoading(true);
         const discordUser = await DiscordService.fetchCurrentUser(token, proxy || '');
         const guilds = await DiscordService.fetchGuilds(token, proxy || '');
         
         setUser(discordUser);
         setDiscordToken(token);
         setProxyUrl(proxy || '');
         setServers([...INITIAL_SERVERS, ...guilds]);
         
         localStorage.setItem('discord_ai_user', JSON.stringify(discordUser));
         localStorage.setItem('discord_token', token);
         if (proxy) localStorage.setItem('discord_proxy', proxy);

       } catch (e) {
         alert("Failed to login to Discord. Check Token or Proxy.");
         return;
       } finally {
         setIsLoading(false);
       }
    } else {
       // AI Only Mode
       const newUser: User = {
        id: 'user-' + Date.now(),
        username,
        discriminator: Math.floor(1000 + Math.random() * 9000).toString(),
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        status: 'online'
      };
      localStorage.setItem('discord_ai_user', JSON.stringify(newUser));
      setUser(newUser);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!user) return;
    const activeServer = servers.find(s => s.id === activeServerId);

    // 1. Real Discord Send
    if (activeServer?.isReal && discordToken) {
       try {
         await DiscordService.sendMessage(activeChannelId, text, discordToken, proxyUrl);
         // Optimistic update
         const newMessage: Message = {
            id: 'temp-' + Date.now(),
            content: text,
            author: user,
            timestamp: new Date().toISOString(),
            channelId: activeChannelId
         };
         setMessages(prev => ({
            ...prev,
            [activeChannelId]: [...(prev[activeChannelId] || []), newMessage]
         }));
       } catch (e) {
         console.error("Failed to send real message", e);
         alert("Failed to send message.");
       }
       return;
    }

    // 2. AI Chat Send (Gemini)
    const newMessage: Message = {
      id: Date.now().toString(),
      content: text,
      author: user,
      timestamp: new Date().toISOString(),
      channelId: activeChannelId
    };

    setMessages(prev => ({
      ...prev,
      [activeChannelId]: [...(prev[activeChannelId] || []), newMessage]
    }));

    setIsLoading(true);

    try {
      const activeChannel = channels.find(c => c.id === activeChannelId);
      const history = messages[activeChannelId] || [];
      
      const aiResponseText = await generateAIResponse(text, activeChannel?.name || 'general', history);

      const botUser: User = {
        id: 'gemini-bot',
        username: 'Gemini',
        discriminator: '0000',
        avatar: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
        status: 'online',
        isBot: true
      };

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: aiResponseText,
        author: botUser,
        timestamp: new Date().toISOString(),
        channelId: activeChannelId
      };

      setMessages(prev => ({
        ...prev,
        [activeChannelId]: [...(prev[activeChannelId] || []), aiMessage]
      }));

    } catch (error) {
      console.error("Failed to get AI response", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return <LoginScreen onLogin={handleLogin} isLoading={isLoading} />;
  }

  const activeServer = servers.find(s => s.id === activeServerId) || servers[0];
  const activeChannel = channels.find(c => c.id === activeChannelId) || channels[0];
  const currentMessages = messages[activeChannelId] || [];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#313338] text-[#dbdee1] font-sans">
      <ServerList 
        servers={servers} 
        activeId={activeServerId} 
        onSelect={setActiveServerId} 
      />
      <ChannelList 
        server={activeServer} 
        channels={channels} 
        categories={categories}
        activeChannelId={activeChannelId} 
        onSelectChannel={setActiveChannelId}
        currentUser={user}
        voiceConnected={voiceConnected}
        setVoiceConnected={setVoiceConnected}
      />
      <div className="flex flex-1 flex-row min-w-0">
        <ChatArea 
          channel={activeChannel} 
          messages={currentMessages} 
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
        />
        <UserList />
      </div>
    </div>
  );
}