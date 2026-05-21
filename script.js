const adminConfig = {
    accessKeyId: "XXXXXXXXXXXXXX",
    secretAccessKey: "XXXXXXXXXXXXXXXXXXXXXXXXX",
    region: "ap-south-1"
};

const managerConfig = {
    accessKeyId: "XXXXXXXXXXXXXXXXXX",
    secretAccessKey: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    region: "ap-south-1"
};

const employeeConfig = {
    accessKeyId: "XXXXXXXXXXXXXXXXX",
    secretAccessKey: "XXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    region: "ap-south-1"
};

const bucketName = "mca-cloud-project-manan";
const apiBaseUrl = "https://9d2c9cw6pf.execute-api.ap-south-1.amazonaws.com";

let s3;
let currentRole = "";

const users = {
    admin: {
        password: "admin123",
        role: "admin",
        name: "Business Owner (Admin)",
        config: adminConfig,
        canUpload: true
    },
    manager: {
        password: "manager123",
        role: "manager",
        name: "Store Manager",
        config: managerConfig,
        canUpload: true
    },
    employee: {
        password: "emp123",
        role: "employee",
        name: "Employee",
        config: employeeConfig,
        canUpload: false
    }
};

function login() {
    const username = document.getElementById("username").value.trim().toLowerCase();
    const password = document.getElementById("password").value.trim();
    const loginStatus = document.getElementById("loginStatus");
    const user = users[username];

    loginStatus.innerText = "";

    if (!user || user.password !== password) {
        loginStatus.innerText = "Wrong username or password";
        return;
    }

    AWS.config.update(user.config);
    currentRole = user.role;

    document.getElementById("currentUser").innerText = user.name;
    document.getElementById("uploadBox").style.display = user.canUpload ? "block" : "none";
    document.getElementById("loginSection").style.display = "none";
    document.getElementById("dashboard").style.display = "block";

    s3 = new AWS.S3({ params: { Bucket: bucketName } });
    loadFiles();
}

async function uploadFile() {
    if (currentRole === "employee") {
        setUploadStatus("Employees can only view documents.", "error");
        return;
    }

    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];
    const category = document.getElementById("documentCategory").value;

    if (!file) {
        setUploadStatus("Please select a file first.", "error");
        return;
    }

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `${category}/${Date.now()}_${cleanFileName}`;

    setUploadStatus("Uploading document to S3...", "info");

    s3.upload({
        Bucket: bucketName,
        Key: s3Key,
        Body: file,
        ContentType: file.type || "application/octet-stream",
        Metadata: {
            uploadedBy: currentRole,
            project: "mca-cloud-computing"
        }
    }, async (error) => {
        if (error) {
            console.error(error);
            setUploadStatus("Upload failed. Please try again.", "error");
            return;
        }

        try {
            await saveMetadata(file.name, category, s3Key, file.size);
            fileInput.value = "";
            setUploadStatus("Upload successful. Waiting for admin approval.", "success");
            await loadFiles();
        } catch (metadataError) {
            console.error(metadataError);
            setUploadStatus("File uploaded, but metadata was not saved.", "error");
        }
    });
}

async function saveMetadata(fileName, category, s3Key, fileSize) {
    const response = await fetch(`${apiBaseUrl}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            documentId: s3Key,
            fileName,
            category,
            uploadedBy: currentRole,
            s3Key,
            fileSize,
            approvalStatus: "Pending"
        })
    });

    if (!response.ok) {
        throw new Error("Metadata save failed");
    }
}

function approveDocument(documentId) {
    updateDocumentStatus(documentId, "Approved");
}

function rejectDocument(documentId) {
    updateDocumentStatus(documentId, "Rejected");
}

async function updateDocumentStatus(documentId, status) {
    if (currentRole !== "admin") {
        alert("Only admin can update document status.");
        return;
    }

    try {
        const response = await fetch(`${apiBaseUrl}/approval`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                documentId,
                status,
                remarks: status === "Approved" ? "Approved by Admin" : "Rejected by Admin"
            })
        });

        if (!response.ok) {
            throw new Error("Approval update failed");
        }

        await loadFiles();
    } catch (error) {
        console.error(error);
        alert("Status update failed. Please check API Gateway or Lambda.");
    }
}

async function loadFiles() {
    const tableBody = document.getElementById("fileTableBody");

    tableBody.innerHTML = `
        <tr>
            <td colspan="6" class="empty-state">Loading records...</td>
        </tr>
    `;

    try {
        const response = await fetch(`${apiBaseUrl}/documents`);

        if (!response.ok) {
            throw new Error("Documents API failed");
        }

        const documents = await response.json();
        renderDocuments(documents || []);
    } catch (error) {
        console.error(error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">Unable to load records.</td>
            </tr>
        `;
        document.getElementById("totalFiles").innerText = "0";
        document.getElementById("storageUsed").innerText = "0 KB";
    }
}

function renderDocuments(documents) {
    const tableBody = document.getElementById("fileTableBody");

    if (!documents.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">No documents found.</td>
            </tr>
        `;
        document.getElementById("totalFiles").innerText = "0";
        document.getElementById("storageUsed").innerText = "0 KB";
        return;
    }

    documents.sort((a, b) => new Date(b.uploadTimestamp || 0) - new Date(a.uploadTimestamp || 0));

    let totalSize = 0;
    tableBody.innerHTML = "";

    documents.forEach((document) => {
        const status = document.approvalStatus || "Pending";
        const fileSize = Number(document.fileSize || 0);
        const documentId = escapeForButton(document.documentId || document.s3Key || "");

        totalSize += fileSize;

        tableBody.innerHTML += `
            <tr>
                <td>${document.fileName || getFileName(document.s3Key)}</td>
                <td><span class="category-pill">${formatCategory(document.category)}</span></td>
                <td><span class="${status.toLowerCase()}">${status}</span></td>
                <td>${formatBytes(fileSize)}</td>
                <td>${formatDate(document.uploadTimestamp)}</td>
                <td>${getActionButtons(document.s3Key, status, documentId)}</td>
            </tr>
        `;
    });

    document.getElementById("totalFiles").innerText = documents.length;
    document.getElementById("storageUsed").innerText = formatBytes(totalSize);
}

function getActionButtons(s3Key, status, documentId) {
    let buttons = `
        <a href="${createSecureUrl(s3Key)}" target="_blank" class="download-btn">View Securely</a>
    `;

    if (currentRole === "admin" && status === "Pending") {
        buttons += `
            <button class="approve-btn" onclick="approveDocument('${documentId}')">Approve</button>
            <button class="reject-btn" onclick="rejectDocument('${documentId}')">Reject</button>
        `;
    }

    return buttons;
}

function createSecureUrl(s3Key) {
    if (!s3Key) return "#";

    return s3.getSignedUrl("getObject", {
        Bucket: bucketName,
        Key: s3Key,
        Expires: 3600
    });
}

function formatCategory(category) {
    if (!category) return "Uncategorized";
    return category.replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function getFileName(s3Key) {
    if (!s3Key) return "Unknown Document";
    return s3Key.split("/").pop().replace(/^\d+_/, "");
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
}

function formatBytes(bytes) {
    if (!bytes) return "0 KB";

    const units = ["Bytes", "KB", "MB", "GB"];
    const index = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, index);

    return `${size.toFixed(2)} ${units[index]}`;
}

function escapeForButton(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function setUploadStatus(message, type) {
    const status = document.getElementById("uploadStatus");

    status.innerText = message;
    status.style.color =
        type === "success" ? "green" :
        type === "error" ? "red" :
        "#2563eb";
}

function logout() {
    location.reload();
}
