import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PointsData {
  id: string;
  name: string;
  brand: string;
  encryptedPoints: string;
  publicRate: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [pointsList, setPointsList] = useState<PointsData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPointsData, setNewPointsData] = useState({ 
    brand: "", 
    points: "", 
    rate: "",
    description: "" 
  });
  const [selectedPoints, setSelectedPoints] = useState<PointsData | null>(null);
  const [decryptedPoints, setDecryptedPoints] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
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
      const pointsData: PointsData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          pointsData.push({
            id: businessId,
            name: businessData.name,
            brand: businessData.name,
            encryptedPoints: businessId,
            publicRate: Number(businessData.publicValue1) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPointsList(pointsData);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPoints = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setExchanging(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted points with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const pointsValue = parseInt(newPointsData.points) || 0;
      const businessId = `points-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, pointsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPointsData.brand,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newPointsData.rate) || 0,
        0,
        newPointsData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Points created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowExchangeModal(false);
      setNewPointsData({ brand: "", points: "", rate: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setExchanging(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
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
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Points decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecrypt = async (points: PointsData) => {
    const decrypted = await decryptData(points.id);
    if (decrypted !== null) {
      setDecryptedPoints(decrypted);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPoints = pointsList.filter(points => 
    points.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
    points.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredPoints.length / itemsPerPage);
  const currentPoints = filteredPoints.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>PointsSwap FHE 🔐</h1>
            <p>Encrypted Loyalty Points Exchange</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted loyalty points exchange system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start exchanging encrypted loyalty points</p>
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
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted points system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PointsSwap FHE 🔐</h1>
          <p>積分隱私互換 · Encrypted Loyalty Points Exchange</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button 
            onClick={() => setShowExchangeModal(true)} 
            className="exchange-btn"
          >
            + New Points
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Points</h3>
            <div className="stat-value">{pointsList.length}</div>
            <div className="stat-label">FHE Protected</div>
          </div>
          
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{pointsList.filter(p => p.isVerified).length}</div>
            <div className="stat-label">On-chain Verified</div>
          </div>
          
          <div className="stat-panel">
            <h3>Active Brands</h3>
            <div className="stat-value">{new Set(pointsList.map(p => p.brand)).size}</div>
            <div className="stat-label">Participating</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text"
              placeholder="Search points by brand or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="points-list">
          <div className="list-header">
            <h2>Encrypted Loyalty Points</h2>
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages || totalPages === 0}
              >
                Next
              </button>
            </div>
          </div>
          
          {currentPoints.length === 0 ? (
            <div className="no-points">
              <p>No loyalty points found</p>
              <button 
                className="exchange-btn" 
                onClick={() => setShowExchangeModal(true)}
              >
                Create First Points
              </button>
            </div>
          ) : currentPoints.map((points, index) => (
            <div 
              className={`points-item ${selectedPoints?.id === points.id ? "selected" : ""} ${points.isVerified ? "verified" : ""}`} 
              key={index}
              onClick={() => setSelectedPoints(points)}
            >
              <div className="points-brand">{points.brand}</div>
              <div className="points-meta">
                <span>Exchange Rate: 1:{points.publicRate}</span>
                <span>Created: {new Date(points.timestamp * 1000).toLocaleDateString()}</span>
              </div>
              <div className="points-status">
                Status: {points.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                {points.isVerified && points.decryptedValue && (
                  <span className="points-amount">Points: {points.decryptedValue}</span>
                )}
              </div>
              <div className="points-description">{points.description}</div>
            </div>
          ))}
        </div>

        <div className="faq-section">
          <h3>Frequently Asked Questions</h3>
          <div className="faq-item">
            <h4>How does FHE protect my points?</h4>
            <p>Your loyalty points are encrypted using Zama FHE technology, ensuring brands cannot see each other's point balances while enabling secure exchanges.</p>
          </div>
          <div className="faq-item">
            <h4>What data is public?</h4>
            <p>Only exchange rates and brand information are public. Point balances remain fully encrypted and private.</p>
          </div>
        </div>
      </div>
      
      {showExchangeModal && (
        <div className="modal-overlay">
          <div className="exchange-modal">
            <div className="modal-header">
              <h2>Create Encrypted Points</h2>
              <button onClick={() => setShowExchangeModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Encryption</strong>
                <p>Points value will be encrypted with Zama FHE (Integer only)</p>
              </div>
              
              <div className="form-group">
                <label>Brand Name *</label>
                <input 
                  type="text" 
                  value={newPointsData.brand} 
                  onChange={(e) => setNewPointsData({...newPointsData, brand: e.target.value})} 
                  placeholder="Enter brand name..." 
                />
              </div>
              
              <div className="form-group">
                <label>Points Value (Integer only) *</label>
                <input 
                  type="number" 
                  value={newPointsData.points} 
                  onChange={(e) => setNewPointsData({...newPointsData, points: e.target.value})} 
                  placeholder="Enter points value..." 
                  step="1"
                  min="0"
                />
                <div className="data-type-label">FHE Encrypted Integer</div>
              </div>
              
              <div className="form-group">
                <label>Exchange Rate *</label>
                <input 
                  type="number" 
                  min="1" 
                  value={newPointsData.rate} 
                  onChange={(e) => setNewPointsData({...newPointsData, rate: e.target.value})} 
                  placeholder="Enter exchange rate..." 
                />
                <div className="data-type-label">Public Data</div>
              </div>

              <div className="form-group">
                <label>Description</label>
                <input 
                  type="text" 
                  value={newPointsData.description} 
                  onChange={(e) => setNewPointsData({...newPointsData, description: e.target.value})} 
                  placeholder="Enter description..." 
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowExchangeModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createPoints} 
                disabled={exchanging || isEncrypting || !newPointsData.brand || !newPointsData.points || !newPointsData.rate} 
                className="submit-btn"
              >
                {exchanging || isEncrypting ? "Encrypting and Creating..." : "Create Points"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedPoints && (
        <div className="modal-overlay">
          <div className="points-detail-modal">
            <div className="modal-header">
              <h2>Points Details</h2>
              <button onClick={() => {
                setSelectedPoints(null);
                setDecryptedPoints(null);
              }} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="points-info">
                <div className="info-item">
                  <span>Brand:</span>
                  <strong>{selectedPoints.brand}</strong>
                </div>
                <div className="info-item">
                  <span>Creator:</span>
                  <strong>{selectedPoints.creator.substring(0, 6)}...{selectedPoints.creator.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Date Created:</span>
                  <strong>{new Date(selectedPoints.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
                <div className="info-item">
                  <span>Exchange Rate:</span>
                  <strong>1:{selectedPoints.publicRate}</strong>
                </div>
                <div className="info-item">
                  <span>Description:</span>
                  <strong>{selectedPoints.description}</strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Points Data</h3>
                
                <div className="data-row">
                  <div className="data-label">Points Value:</div>
                  <div className="data-value">
                    {selectedPoints.isVerified && selectedPoints.decryptedValue ? 
                      `${selectedPoints.decryptedValue} (On-chain Verified)` : 
                      decryptedPoints !== null ? 
                      `${decryptedPoints} (Locally Decrypted)` : 
                      "🔒 FHE Encrypted Integer"
                    }
                  </div>
                  <button 
                    className={`decrypt-btn ${(selectedPoints.isVerified || decryptedPoints !== null) ? 'decrypted' : ''}`}
                    onClick={() => handleDecrypt(selectedPoints)} 
                    disabled={isDecrypting || fheIsDecrypting}
                  >
                    {isDecrypting || fheIsDecrypting ? (
                      "🔓 Verifying..."
                    ) : selectedPoints.isVerified ? (
                      "✅ Verified"
                    ) : decryptedPoints !== null ? (
                      "🔄 Re-verify"
                    ) : (
                      "🔓 Verify Decryption"
                    )}
                  </button>
                </div>
                
                <div className="fhe-info">
                  <div className="fhe-icon">🔐</div>
                  <div>
                    <strong>FHE 🔐 Self-Relaying Decryption</strong>
                    <p>Points are encrypted on-chain. Click "Verify Decryption" to perform offline decryption and on-chain verification.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedPoints(null);
                setDecryptedPoints(null);
              }} className="close-btn">Close</button>
            </div>
          </div>
        </div>
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

export default App;