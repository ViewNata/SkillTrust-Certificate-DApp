SkillTrust Digital Certificate DApp

1. Open CertificateRegistry.sol in Remix; compile with Solidity 0.8.20 and deploy to Sepolia using MetaMask.
2. Put the Sepolia Infura Project ID and deployed contract address in config.js. Never use an Infura API Secret in browser code.
3. Open index.html with VS Code Live Server. Connect the deployer wallet to create courses and issue certificates. Recipients connect their wallet to view their certificates.
4. Verify by ID or upload the downloaded JSON file to compare its hash and on-chain status.

Only hashes and wallet addresses/course IDs are on chain; learner names stay in the downloadable JSON file. Revoke function is owner-only in the contract.
