import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface PointsSwapData {
  id: number;
  brand: string;
  points: string;
  exchangeRate: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface SwapAnalysis {
  liquidityScore: number;
  rateAdvantage: number;
  securityLevel: number;
  popularity: number;
  growthPotential: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [swaps, setSwaps] = useState<PointsSwapData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSwap, setCreatingSwap] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newSwapData, setNewSwapData] = useState({ brand: "", points: "", rate: "" });
  const [selectedSwap, setSelectedSwap] = useState<PointsSwapData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ points: number | null; rate: number | null }>({ points: null, rate: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterBrand, setFilterBrand] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  const faqItems = [
    { question: "什么是FHE加密积分互换？", answer: "全同态加密技术允许在加密状态下计算积分汇率，保护用户隐私。" },
    { question: "品牌方能看到我的积分吗？", answer: "不能，所有积分数据都经过FHE加密，品牌方只能看到加密结果。" },
    { question: "如何验证解密结果？", answer: "通过FHE.checkSignatures进行链上验证，确保解密数据的真实性。" },
    { question: "支持哪些品牌的积分？", answer: "目前支持所有接入系统的品牌积分互换。" }
  ];

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for Points Swap...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM初始化失败" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const swapsList: PointsSwapData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          swapsList.push({
            id: parseInt(businessId.replace('swap-', '')) || Date.now(),
            brand: businessData.name,
            points: businessId,
            exchangeRate: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSwaps(swapsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createSwap = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSwap(true);
    setTransactionStatus({ visible: true, status: "pending", message: "创建积分互换中..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");
      
      const pointsValue = parseInt(newSwapData.points) || 0;
      const businessId = `swap-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, pointsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSwapData.brand,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newSwapData.rate) || 0,
        0,
        "积分互换记录"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, {
        type: "create",
        brand: newSwapData.brand,
        points: pointsValue,
        timestamp: Date.now()
      }]);
      
      setTransactionStatus({ visible: true, status: "success", message: "积分互换创建成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewSwapData({ brand: "", points: "", rate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "用户取消交易" 
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSwap(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "链上验证解密中..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      setUserHistory(prev => [...prev, {
        type: "decrypt",
        brand: businessData.name,
        value: Number(clearValue),
        timestamp: Date.now()
      }]);
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "数据已完成链上验证" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "解密失败: " + (e.message || "未知错误") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "系统可用性检查成功!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "调用失败: " + (e.message || "未知错误") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeSwap = (swap: PointsSwapData, decryptedPoints: number | null, decryptedRate: number | null): SwapAnalysis => {
    const points = swap.isVerified ? (swap.decryptedValue || 0) : (decryptedPoints || swap.publicValue1 || 50);
    const rate = swap.publicValue1 || 1;
    
    const baseLiquidity = Math.min(100, Math.round((points * 0.6 + rate * 40) * 0.1));
    const timeFactor = Math.max(0.7, Math.min(1.3, 1 - (Date.now()/1000 - swap.timestamp) / (60 * 60 * 24 * 7)));
    const liquidityScore = Math.round(baseLiquidity * timeFactor);
    
    const rateAdvantage = Math.round((2 - rate) * 50);
    const securityLevel = Math.min(100, Math.round(points * 0.2 + 80));
    
    const popularity = Math.min(95, Math.round((points * 0.3 + rate * 20) * 0.15));
    const growthPotential = Math.min(100, Math.round((points * 0.4 + (2-rate) * 30) * 0.2));

    return {
      liquidityScore,
      rateAdvantage,
      securityLevel,
      popularity,
      growthPotential
    };
  };

  const renderDashboard = () => {
    const totalSwaps = swaps.length;
    const verifiedSwaps = swaps.filter(s => s.isVerified).length;
    const avgRate = swaps.length > 0 
      ? swaps.reduce((sum, s) => sum + s.publicValue1, 0) / swaps.length 
      : 0;
    
    const todaySwaps = swaps.filter(s => 
      Date.now()/1000 - s.timestamp < 60 * 60 * 24
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel metal-panel">
          <h3>总互换数</h3>
          <div className="stat-value">{totalSwaps}</div>
          <div className="stat-trend">+{todaySwaps} 今日</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>已验证数据</h3>
          <div className="stat-value">{verifiedSwaps}/{totalSwaps}</div>
          <div className="stat-trend">FHE验证完成</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>平均汇率</h3>
          <div className="stat-value">{avgRate.toFixed(2)}</div>
          <div className="stat-trend">同态计算</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (swap: PointsSwapData, decryptedPoints: number | null, decryptedRate: number | null) => {
    const analysis = analyzeSwap(swap, decryptedPoints, decryptedRate);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">流动性评分</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.liquidityScore}%` }}
            >
              <span className="bar-value">{analysis.liquidityScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">汇率优势</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.rateAdvantage}%` }}
            >
              <span className="bar-value">{analysis.rateAdvantage}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">安全等级</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.securityLevel}%` }}
            >
              <span className="bar-value">{analysis.securityLevel}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">受欢迎度</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.popularity}%` }}
            >
              <span className="bar-value">{analysis.popularity}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">增长潜力</div>
          <div className="chart-bar">
            <div 
              className="bar-fill growth" 
              style={{ width: `${analysis.growthPotential}%` }}
            >
              <span className="bar-value">{analysis.growthPotential}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredSwaps = swaps.filter(swap => {
    const matchesSearch = swap.brand.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBrand = filterBrand === "all" || swap.brand === filterBrand;
    return matchesSearch && matchesBrand;
  });

  const uniqueBrands = [...new Set(swaps.map(swap => swap.brand))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 PointsSwap FHE</h1>
            <span className="subtitle">加密积分隐私互换</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>连接钱包开始使用</h2>
            <p>连接您的钱包来初始化加密积分互换系统，保护您的积分隐私。</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>点击上方按钮连接钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统将自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>开始安全的积分互换交易</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
        <p className="loading-note">这可能需要一些时间</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密积分系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 PointsSwap FHE</h1>
          <span className="subtitle">加密积分隐私互换</span>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="check-btn">
            系统检查
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建互换
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn"
          >
            {showFAQ ? "隐藏帮助" : "常见问题"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      {showFAQ && (
        <div className="faq-section">
          <h3>常见问题解答</h3>
          <div className="faq-list">
            {faqItems.map((item, index) => (
              <div key={index} className="faq-item">
                <div className="faq-question">{item.question}</div>
                <div className="faq-answer">{item.answer}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>积分互换分析 (FHE 🔐)</h2>
          {renderDashboard()}
        </div>
        
        <div className="swaps-section">
          <div className="section-header">
            <h2>积分互换记录</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="搜索品牌..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <select 
                  value={filterBrand} 
                  onChange={(e) => setFilterBrand(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">所有品牌</option>
                  {uniqueBrands.map(brand => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新"}
              </button>
            </div>
          </div>
          
          <div className="swaps-list">
            {filteredSwaps.length === 0 ? (
              <div className="no-swaps">
                <p>未找到积分互换记录</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  创建第一个互换
                </button>
              </div>
            ) : filteredSwaps.map((swap, index) => (
              <div 
                className={`swap-item ${selectedSwap?.id === swap.id ? "selected" : ""} ${swap.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedSwap(swap)}
              >
                <div className="swap-brand">{swap.brand}</div>
                <div className="swap-meta">
                  <span>汇率: {swap.publicValue1}</span>
                  <span>时间: {new Date(swap.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="swap-status">
                  状态: {swap.isVerified ? "✅ 链上已验证" : "🔓 待验证"}
                  {swap.isVerified && swap.decryptedValue && (
                    <span className="verified-amount">积分: {swap.decryptedValue}</span>
                  )}
                </div>
                <div className="swap-creator">创建者: {swap.creator.substring(0, 6)}...{swap.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>

        {userHistory.length > 0 && (
          <div className="history-section">
            <h3>用户操作历史</h3>
            <div className="history-list">
              {userHistory.slice(-5).reverse().map((record, index) => (
                <div key={index} className="history-item">
                  <span className="history-type">{record.type === "create" ? "创建" : "解密"}</span>
                  <span className="history-brand">{record.brand}</span>
                  <span className="history-value">{record.value}</span>
                  <span className="history-time">{new Date(record.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <ModalCreateSwap 
          onSubmit={createSwap} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingSwap} 
          swapData={newSwapData} 
          setSwapData={setNewSwapData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedSwap && (
        <SwapDetailModal 
          swap={selectedSwap} 
          onClose={() => { 
            setSelectedSwap(null); 
            setDecryptedData({ points: null, rate: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedSwap.points)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSwap: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  swapData: any;
  setSwapData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, swapData, setSwapData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'points') {
      const intValue = value.replace(/[^\d]/g, '');
      setSwapData({ ...swapData, [name]: intValue });
    } else {
      setSwapData({ ...swapData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-swap-modal">
        <div className="modal-header">
          <h2>新建积分互换</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 加密保护</strong>
            <p>积分数量将使用Zama FHE加密（仅支持整数）</p>
          </div>
          
          <div className="form-group">
            <label>品牌名称 *</label>
            <input 
              type="text" 
              name="brand" 
              value={swapData.brand} 
              onChange={handleChange} 
              placeholder="输入品牌名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>积分数量（整数） *</label>
            <input 
              type="number" 
              name="points" 
              value={swapData.points} 
              onChange={handleChange} 
              placeholder="输入积分数量..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>兑换汇率 *</label>
            <input 
              type="number" 
              min="0.1" 
              max="10" 
              step="0.1"
              name="rate" 
              value={swapData.rate} 
              onChange={handleChange} 
              placeholder="输入兑换汇率..." 
            />
            <div className="data-type-label">公开数据</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !swapData.brand || !swapData.points || !swapData.rate} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建互换"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SwapDetailModal: React.FC<{
  swap: PointsSwapData;
  onClose: () => void;
  decryptedData: { points: number | null; rate: number | null };
  setDecryptedData: (value: { points: number | null; rate: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (swap: PointsSwapData, decryptedPoints: number | null, decryptedRate: number | null) => JSX.Element;
}> = ({ swap, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.points !== null) { 
      setDecryptedData({ points: null, rate: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ points: decrypted, rate: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="swap-detail-modal">
        <div className="modal-header">
          <h2>积分互换详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="swap-info">
            <div className="info-item">
              <span>品牌名称:</span>
              <strong>{swap.brand}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{swap.creator.substring(0, 6)}...{swap.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(swap.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>兑换汇率:</span>
              <strong>{swap.publicValue1}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>加密积分数据</h3>
            
            <div className="data-row">
              <div className="data-label">积分数量:</div>
              <div className="data-value">
                {swap.isVerified && swap.decryptedValue ? 
                  `${swap.decryptedValue} (链上已验证)` : 
                  decryptedData.points !== null ? 
                  `${decryptedData.points} (本地解密)` : 
                  "🔒 FHE加密整数"
                }
              </div>
              <button 
                className={`decrypt-btn ${(swap.isVerified || decryptedData.points !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : swap.isVerified ? (
                  "✅ 已验证"
                ) : decryptedData.points !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 自中继解密</strong>
                <p>数据在链上加密存储。点击"验证解密"进行离线解密和链上FHE.checkSignatures验证。</p>
              </div>
            </div>
          </div>
          
          {(swap.isVerified || decryptedData.points !== null) && (
            <div className="analysis-section">
              <h3>实时互换分析</h3>
              {renderAnalysisChart(
                swap, 
                swap.isVerified ? swap.decryptedValue || null : decryptedData.points, 
                null
              )}
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>积分数量:</span>
                  <strong>
                    {swap.isVerified ? 
                      `${swap.decryptedValue} (链上已验证)` : 
                      `${decryptedData.points} (本地解密)`
                    }
                  </strong>
                  <span className={`data-badge ${swap.isVerified ? 'verified' : 'local'}`}>
                    {swap.isVerified ? '链上验证' : '本地解密'}
                  </span>
                </div>
                <div className="value-item">
                  <span>兑换汇率:</span>
                  <strong>{swap.publicValue1}</strong>
                  <span className="data-badge public">公开数据</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!swap.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;