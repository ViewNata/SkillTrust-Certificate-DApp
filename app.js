(() => {
  const cfg = window.CERTIFICATE_CONFIG || {};
  const ABI = [
    "function owner() view returns (address)",
    "function nextCourseId() view returns (uint256)",
    "function nextCertificateId() view returns (uint256)",
    "function courses(uint256) view returns (string code,string title,string description,bool active)",
    "function createCourse(string code,string title,string description) returns (uint256)",
    "function issueCertificate(bytes32 documentHash,address recipient,uint256 courseId) returns (uint256)",
    "function revokeCertificate(uint256 certificateId)",
    "function getCertificate(uint256 certificateId) view returns (bytes32 documentHash,address recipient,uint256 courseId,uint64 issuedAt,uint64 revokedAt,bool revoked)",
    "function getCertificateIds(address recipient) view returns (uint256[])",
    "function getAllCertificateIds() view returns (uint256[])",
    "event CourseCreated(uint256 indexed courseId,string code,string title)",
    "event CertificateIssued(uint256 indexed certificateId,bytes32 indexed documentHash,address indexed recipient,uint256 courseId,uint64 issuedAt)",
    "event CertificateRevoked(uint256 indexed certificateId,address indexed revokedBy,uint64 revokedAt)"
  ];
  const $ = (id) => document.getElementById(id);
  let readProvider, readContract, walletProvider, signer, writeContract, account, owner, courses = [];

  function toast(msg) { const el = $("toast"); el.textContent = msg; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 4200); }
  function result(id, msg, type = "") { const el = $(id); el.className = `result ${type}`; el.textContent = msg; }
  function short(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
  function date(ts) { return new Date(Number(ts) * 1000).toLocaleString("th-TH"); }
  function configReady() {
    if (!cfg.infuraProjectId || cfg.infuraProjectId.includes("YOUR_")) throw new Error("ใส่ Infura Sepolia Project ID ใน config.js ก่อน");
    if (!ethers.isAddress(cfg.contractAddress)) throw new Error("ใส่ Contract Address ที่ deploy แล้วใน config.js ก่อน");
  }
  function initReader() {
    configReady();
    readProvider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${cfg.infuraProjectId}`);
    readContract = new ethers.Contract(cfg.contractAddress, ABI, readProvider);
  }
  function onlyOwner() { return account && owner && account.toLowerCase() === owner.toLowerCase(); }

  async function connect() {
    try {
      if (!window.ethereum) throw new Error("กรุณาเปิดเว็บในเบราว์เซอร์ที่ติดตั้ง MetaMask");
      initReader();
      walletProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await walletProvider.send("eth_requestAccounts", []);
      const net = await walletProvider.getNetwork();
      if (Number(net.chainId) !== Number(cfg.chainId || 11155111)) throw new Error("เปลี่ยนเครือข่าย MetaMask เป็น Sepolia ก่อน");
      account = accounts[0]; signer = await walletProvider.getSigner();
      owner = await readContract.owner();
      writeContract = new ethers.Contract(cfg.contractAddress, ABI, signer);
      $("connect").textContent = short(account);
      $("walletLabel").textContent = `Wallet: ${account}`;
      toast(onlyOwner() ? "เชื่อมต่อแล้ว · บัญชีผู้ดูแลระบบ" : "เชื่อมต่อกระเป๋าแล้ว");
      await Promise.all([loadCourses(), loadDashboard()]);
    } catch (e) { toast(e.shortMessage || e.message); }
  }

  async function loadCourses() {
    const next = Number(await readContract.nextCourseId()); courses = [];
    const list = $("courseList"), select = $("courseSelect"); list.innerHTML = ""; select.innerHTML = "";
    for (let id = 1; id < next; id++) {
      const c = await readContract.courses(id); if (!c.active) continue;
      courses.push({ id, code: c.code, title: c.title, description: c.description });
      const item = document.createElement("div"); item.className = "cert";
      item.innerHTML = `<div><b>${escapeHtml(c.code)} · ${escapeHtml(c.title)}</b><small>${escapeHtml(c.description || "")} · ID ${id}</small></div><span class="badge">ACTIVE</span>`; list.appendChild(item);
      const option = document.createElement("option"); option.value = id; option.textContent = `${c.code} · ${c.title}`; select.appendChild(option);
    }
    if (!courses.length) list.innerHTML = '<div class="empty">ยังไม่มีหลักสูตร เพิ่มหลักสูตรด้วยบัญชีผู้ดูแล</div>';
    if (!courses.length) select.innerHTML = '<option value="">ยังไม่มีหลักสูตร</option>';
    $("createCourse").disabled = !onlyOwner(); $("issueButton").disabled = !onlyOwner();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  async function createCourse() {
    if (!onlyOwner()) return toast("เฉพาะ wallet ผู้ deploy สัญญาที่เพิ่มหลักสูตรได้");
    const code = $("courseCode").value.trim(), title = $("courseTitle").value.trim(), description = $("courseDescription").value.trim();
    if (!code || !title) return toast("กรอกรหัสและชื่อหลักสูตรก่อน");
    try { toast("ยืนยันการสร้างหลักสูตรใน MetaMask…"); const tx = await writeContract.createCourse(code, title, description); await tx.wait(); await loadCourses(); toast("สร้างหลักสูตรสำเร็จ"); }
    catch (e) { toast(e.shortMessage || e.reason || e.message); }
  }

  async function issueCertificate() {
    if (!onlyOwner()) return toast("เฉพาะ wallet ผู้ deploy สัญญาที่ออกใบรับรองได้");
    const recipient = $("recipient").value.trim(), learnerName = $("learnerName").value.trim(), courseId = Number($("courseSelect").value);
    if (!ethers.isAddress(recipient) || !learnerName || !courseId) return result("issueResult", "กรอก wallet ผู้รับ ชื่อผู้เข้าอบรม และเลือกหลักสูตรให้ครบ", "bad");
    try {
      // Use a fresh MetaMask signer for both the owner check and the transaction.
      // This prevents a stale page account or an unrelated read provider from
      // being mistaken for the account that actually sends the transaction.
      const freshProvider = new ethers.BrowserProvider(window.ethereum);
      await freshProvider.send("eth_requestAccounts", []);
      const network = await freshProvider.getNetwork();
      if (Number(network.chainId) !== Number(cfg.chainId || 11155111)) {
        throw new Error("กรุณาเลือกเครือข่าย Sepolia ใน MetaMask");
      }
      const freshSigner = await freshProvider.getSigner();
      const sender = await freshSigner.getAddress();
      const freshContract = new ethers.Contract(cfg.contractAddress, ABI, freshSigner);
      const actualOwner = await freshContract.owner();
      account = sender;
      owner = actualOwner;
      signer = freshSigner;
      writeContract = freshContract;
      if (sender.toLowerCase() !== actualOwner.toLowerCase()) {
        throw new Error(`บัญชีที่ MetaMask จะใช้ส่ง (${sender}) ไม่ใช่ owner ของสัญญา (${actualOwner})`);
      }

      const id = Number(await freshContract.nextCertificateId());
      const course = courses.find(c => c.id === courseId);
      const document = {
        schema: "skilltrust-certificate-v1", certificateId: String(id), learnerName,
        courseId: String(courseId), courseCode: course.code, courseTitle: course.title,
        recipient, issuer: actualOwner, issuedAt: new Date().toISOString(),
        salt: ethers.hexlify(ethers.randomBytes(32))
      };
      const json = JSON.stringify(document, null, 2);
      const hash = ethers.sha256(ethers.toUtf8Bytes(json));
      // Simulate with the same signer first so the UI shows the actual contract
      // revert reason before prompting MetaMask.
      const issueData = new ethers.Interface(ABI).encodeFunctionData(
        "issueCertificate", [hash, recipient, courseId]
      );
      // Explicitly set `from` for the preflight call. This makes the simulated
      // msg.sender unambiguous and match the account shown by MetaMask.
      await freshProvider.call({ from: sender, to: cfg.contractAddress, data: issueData });
      result("issueResult", `ตรวจสิทธิ์ผ่านแล้ว · ผู้ส่ง ${sender}\nOwner: ${actualOwner}\nกำลังส่งธุรกรรมผ่าน MetaMask…`);
      const tx = await freshSigner.sendTransaction({ to: cfg.contractAddress, data: issueData });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error("ธุรกรรมไม่สำเร็จบน Sepolia");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = documentCreateLink(url, `skilltrust-certificate-${id}.json`);
      $("downloadArea").replaceChildren(link);
      const verifyUrl = `${location.origin}${location.pathname}#verify=${id}`;
      $("qrArea").innerHTML = `<p class="help">QR สำหรับตรวจสอบสถานะบน chain</p><img class="qr" alt="Certificate verification QR" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(verifyUrl)}">`;
      result("issueResult", `ออกใบรับรองสำเร็จ · ID ${id}\nHash: ${hash}\nดาวน์โหลดไฟล์และส่งให้ผู้รับ โดยเก็บไฟล์นี้ให้ปลอดภัย`, "good");
      await loadDashboard();
    } catch (e) {
      const detail = e.reason || e.shortMessage || e.info?.error?.message || e.message;
      result("issueResult", `${detail}\nผู้ส่งจาก MetaMask: ${account || "ไม่พบ"}\nOwner ที่อ่านได้: ${owner || "ยังอ่านไม่ได้"}\nContract: ${cfg.contractAddress}\nถ้ายังขึ้น Only registry owner ให้ตรวจว่า address ใน config.js เป็น address ของสัญญาที่เพิ่ง deploy ใน Remix หรือไม่`, "bad");
    }
  }


  function documentCreateLink(url, name) { const a = document.createElement("a"); a.href = url; a.download = name; a.className = "primary"; a.textContent = `ดาวน์โหลดไฟล์ใบรับรอง ${name}`; a.style.display = "inline-block"; a.style.textDecoration = "none"; a.style.padding = "10px 13px"; a.style.borderRadius = "9px"; return a; }

  async function verifyId(id) {
    if (!id || !Number.isInteger(Number(id)) || Number(id) < 1) return result("verifyResult", "กรุณาใส่ Certificate ID ที่ถูกต้อง", "bad");
    try {
      const c = await readContract.getCertificate(id), course = await readContract.courses(c.courseId);
      const state = c.revoked ? "REVOKED · ใบรับรองนี้ถูกเพิกถอน" : "VALID · ใบรับรองยังมีผล";
      result("verifyResult", `${state}\nCertificate ID: ${id}\nหลักสูตร: ${course.code} · ${course.title}\nผู้รับ wallet: ${c.recipient}\nออกเมื่อ: ${date(c.issuedAt)}\nDocument hash: ${c.documentHash}${c.revoked ? `\nเพิกถอนเมื่อ: ${date(c.revokedAt)}` : ""}`, c.revoked ? "bad" : "good");
    } catch (e) { result("verifyResult", "ไม่พบใบรับรองนี้บนบล็อกเชน หรืออ่าน Infura ไม่สำเร็จ: " + (e.shortMessage || e.message), "bad"); }
  }
  async function verifyFile() {
    const file = $("certificateFile").files[0]; if (!file) return result("fileResult", "เลือกไฟล์ JSON ก่อน", "bad");
    try {
      const text = await file.text(), data = JSON.parse(text);
      if (data.schema !== "skilltrust-certificate-v1" || !data.certificateId) throw new Error("รูปแบบไฟล์ไม่ถูกต้อง");
      const localHash = ethers.sha256(ethers.toUtf8Bytes(text));
      const c = await readContract.getCertificate(data.certificateId);
      const match = localHash.toLowerCase() === c.documentHash.toLowerCase();
      const status = c.revoked ? "ใบรับรองถูกเพิกถอน" : "ใบรับรองยังมีผล";
      result("fileResult", `${match ? "HASH MATCH · ไฟล์ตรงกับหลักฐานบนบล็อกเชน" : "HASH MISMATCH · ไฟล์ไม่ตรงหรือถูกแก้ไข"}\n${status}\nชื่อในไฟล์: ${data.learnerName}\nหลักสูตร: ${data.courseTitle}\nรหัส: ${data.certificateId}\nHash: ${localHash}`, match && !c.revoked ? "good" : "bad");
    } catch (e) { result("fileResult", "ตรวจไฟล์ไม่สำเร็จ: " + (e.shortMessage || e.message), "bad"); }
  }

  async function loadDashboard() {
    if (!account) return;
    // getAllCertificateIds is owner-gated. Infura's read-only provider otherwise
    // calls it with the zero address, which caused a misleading
    // "Only registry owner" error after a certificate had already been issued.
    const ids = onlyOwner()
      ? await readContract.getAllCertificateIds({ from: account })
      : await readContract.getCertificateIds(account);
    const list = $("myCertificates"); list.innerHTML = "";
    if (!ids.length) { list.innerHTML = '<div class="empty">ยังไม่มีใบรับรองที่ผูกกับ wallet นี้</div>'; return; }
    // Certificate IDs increase as certificates are issued, so descending IDs
    // put the most recently issued certificate first in the dashboard.
    for (const rawId of [...ids].sort((a, b) => Number(b) - Number(a))) {
      const id = Number(rawId), c = await readContract.getCertificate(id), course = await readContract.courses(c.courseId);
      const item = document.createElement("div"); item.className = "cert";
      const details = document.createElement("div"); details.innerHTML = `<b>${escapeHtml(course.code)} · ${escapeHtml(course.title)}</b><small>ID ${id} · ออก ${date(c.issuedAt)}<br>${c.documentHash}</small>`;
      const actions = document.createElement("div"), badge = document.createElement("span"); badge.className = `badge${c.revoked ? " revoked" : ""}`; badge.textContent = c.revoked ? "REVOKED" : "VALID"; actions.appendChild(badge);
      if (onlyOwner() && !c.revoked) { const revoke = document.createElement("button"); revoke.className = "danger"; revoke.textContent = "เพิกถอน"; revoke.onclick = () => revokeCertificate(id); actions.appendChild(revoke); }
      item.append(details, actions); list.appendChild(item);
    }
  }
  async function revokeCertificate(id) {
    if (!onlyOwner() || !confirm(`ยืนยันเพิกถอนใบรับรอง ID ${id}? ประวัติจะยังอยู่บนบล็อกเชน`)) return;
    try { const tx = await writeContract.revokeCertificate(id); await tx.wait(); await loadDashboard(); toast(`เพิกถอนใบรับรอง ${id} แล้ว`); }
    catch (e) { toast(e.shortMessage || e.reason || e.message); }
  }

  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach(p => {
      const selected = p.id === tab.dataset.panel;
      p.classList.toggle("active", selected);
      p.hidden = !selected;
    });
  }));
  $("connect").addEventListener("click", connect);
  $("verifyButton").addEventListener("click", () => verifyId($("verifyId").value));
  $("fileVerifyButton").addEventListener("click", verifyFile);
  $("createCourse").addEventListener("click", createCourse);
  $("issueButton").addEventListener("click", issueCertificate);
  window.addEventListener("hashchange", () => { const match = location.hash.match(/^#verify=(\d+)$/); if (match) { document.querySelector('[data-panel="verify"]').click(); $("verifyId").value = match[1]; verifyId(match[1]); } });
  if (window.ethereum) { window.ethereum.on("accountsChanged", () => location.reload()); window.ethereum.on("chainChanged", () => location.reload()); }
  try { initReader(); const m = location.hash.match(/^#verify=(\d+)$/); if (m) { $("verifyId").value = m[1]; verifyId(m[1]); } } catch (e) { toast(e.message); }
})();
