// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Store only opaque document hashes and wallet addresses on-chain.
/// Personal certificate details belong in the off-chain certificate file.
contract CertificateRegistry {
    address public owner;
    uint256 public nextCourseId = 1;
    uint256 public nextCertificateId = 1;

    struct Course {
        string code;
        string title;
        string description;
        bool active;
    }

    struct Certificate {
        bytes32 documentHash;
        address recipient;
        uint256 courseId;
        uint64 issuedAt;
        uint64 revokedAt;
        bool revoked;
    }

    mapping(uint256 => Course) public courses;
    mapping(uint256 => Certificate) private certificates;
    mapping(bytes32 => uint256) public certificateIdByHash;
    mapping(address => uint256[]) private recipientCertificates;
    uint256[] private allCertificateIds;

    event CourseCreated(uint256 indexed courseId, string code, string title);
    event CertificateIssued(uint256 indexed certificateId, bytes32 indexed documentHash, address indexed recipient, uint256 courseId, uint64 issuedAt);
    event CertificateRevoked(uint256 indexed certificateId, address indexed revokedBy, uint64 revokedAt);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only registry owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function createCourse(string calldata code, string calldata title, string calldata description)
        external onlyOwner returns (uint256 courseId)
    {
        require(bytes(code).length > 0 && bytes(title).length > 0, "Course code and title required");
        courseId = nextCourseId++;
        courses[courseId] = Course(code, title, description, true);
        emit CourseCreated(courseId, code, title);
    }

    function issueCertificate(bytes32 documentHash, address recipient, uint256 courseId)
        external onlyOwner returns (uint256 certificateId)
    {
        require(documentHash != bytes32(0), "Document hash required");
        require(recipient != address(0), "Recipient required");
        require(courses[courseId].active, "Course does not exist or inactive");
        require(certificateIdByHash[documentHash] == 0, "This certificate hash already exists");
        certificateId = nextCertificateId++;
        uint64 timestamp = uint64(block.timestamp);
        certificates[certificateId] = Certificate(documentHash, recipient, courseId, timestamp, 0, false);
        certificateIdByHash[documentHash] = certificateId;
        recipientCertificates[recipient].push(certificateId);
        allCertificateIds.push(certificateId);
        emit CertificateIssued(certificateId, documentHash, recipient, courseId, timestamp);
    }

    function revokeCertificate(uint256 certificateId) external onlyOwner {
        Certificate storage cert = certificates[certificateId];
        require(cert.issuedAt != 0, "Certificate not found");
        require(!cert.revoked, "Certificate already revoked");
        cert.revoked = true;
        cert.revokedAt = uint64(block.timestamp);
        emit CertificateRevoked(certificateId, msg.sender, cert.revokedAt);
    }

    function getCertificate(uint256 certificateId) external view returns (
        bytes32 documentHash, address recipient, uint256 courseId, uint64 issuedAt, uint64 revokedAt, bool revoked
    ) {
        Certificate storage cert = certificates[certificateId];
        require(cert.issuedAt != 0, "Certificate not found");
        return (cert.documentHash, cert.recipient, cert.courseId, cert.issuedAt, cert.revokedAt, cert.revoked);
    }

    function getCertificateIds(address recipient) external view returns (uint256[] memory) {
        return recipientCertificates[recipient];
    }

    function getAllCertificateIds() external view onlyOwner returns (uint256[] memory) {
        return allCertificateIds;
    }
}
