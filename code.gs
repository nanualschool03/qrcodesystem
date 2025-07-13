// Your Google Drive Folder ID
const FOLDER_ID = '1GnGh6QZbY3GVdZrKE2Xj5GHav6lrZ0iQ'; 
// Your Google Sheet ID
const SHEET_ID = '1tW1LYNBrukhE0Bn6J2D0TSieXQ9VCA3eVWYpXZry7Ec'; 

function doPost(e) {
  // ตรวจสอบว่า e และ e.parameter ไม่ใช่ undefined
  if (!e || !e.parameter) {
    Logger.log('CRITICAL ERROR: Event object (e) or its parameters (e.parameter) are undefined. This usually means an incorrect deployment or call method.');
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: 'Request parameters are missing or invalid. Please ensure the request is sent correctly and the Apps Script is deployed as a Web App with access for "Anyone".'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  Logger.log('Received request parameters: ' + JSON.stringify(e.parameter)); // Log all parameters
  const action = e.parameter.action; 
  Logger.log('Action parameter received: ' + (action || 'undefined/null')); // Log the action

  if (action === 'uploadFile') {
    Logger.log('Processing action: uploadFile');
    try {
      const userName = e.parameter.userName;
      const fileName = e.parameter.fileName;
      const fileType = e.parameter.fileType; 
      const source = e.parameter.source; // 'file' or 'url'

      Logger.log(`uploadFile details - userName: ${userName}, fileName: ${fileName}, fileType: ${fileType}, source: ${source}`);

      if (!userName || !fileName || !fileType || !source) {
        Logger.log('Validation failed for uploadFile: Missing required parameters.');
        throw new Error('Missing parameters for uploadFile action.');
      }
      if (source !== 'file' && source !== 'url') {
        Logger.log(`Validation failed for uploadFile: Invalid source value '${source}'.`);
        throw new Error('Invalid source value for uploadFile action: ' + source);
      }

      let driveFile;
      let driveUrl;
      let mimeType;

      if (source === 'file') {
        const fileData = e.parameter.fileData; 
        mimeType = e.parameter.mimeType;
        if (!fileData || !mimeType) {
          Logger.log('Validation failed for uploadFile (source=file): Missing fileData or mimeType.');
          throw new Error('Missing fileData or mimeType for file source.');
        }
        const blob = Utilities.newBlob(Utilities.base64Decode(fileData), mimeType, fileName);
        const folder = DriveApp.getFolderById(FOLDER_ID);
        driveFile = folder.createFile(blob);
        const fileId = driveFile.getId();
        driveUrl = `https://drive.google.com/file/d/${fileId}/view`; 
        Logger.log(`File uploaded to Drive: ${driveUrl}`);
      } else if (source === 'url') {
        const fileUrl = e.parameter.fileUrl;
        if (!fileUrl) {
          Logger.log('Validation failed for uploadFile (source=url): Missing fileUrl.');
          throw new Error('Missing fileUrl for URL source.');
        }
        const response = UrlFetchApp.fetch(fileUrl);
        const blob = response.getBlob().setName(fileName);
        mimeType = blob.getContentType();
        const folder = DriveApp.getFolderById(FOLDER_ID);
        driveFile = folder.createFile(blob);
        const fileId = driveFile.getId();
        driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
        Logger.log(`URL file uploaded to Drive: ${driveUrl}`);
      } 
      
      // --- Generate QR Code Base64 directly and include in response ---
      let qrCodeBase64Image = '';
      try {
        const qrCodeResult = generateQRCodeBase64(fileName, driveUrl);
        qrCodeBase64Image = qrCodeResult.base64Image;
        Logger.log(`QR Code generated for ${fileName}, length: ${qrCodeBase64Image.length}`);
      } catch (qrError) {
        Logger.log(`ERROR generating QR Code for ${fileName}: ${qrError.toString()}`);
        // Fallback to a placeholder image URL if QR code generation fails
        qrCodeBase64Image = 'https://placehold.co/200x200/cccccc/000000?text=QR+Code+Error';
      }
      // --- End QR Code Generation ---

      const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
      if (sheet.getLastRow() === 0) {
        // Updated header: Removed 'QR Code Drive URL'
        sheet.appendRow(['Timestamp', 'User Name', 'File Name', 'File Type', 'Source', 'Google Drive URL']); 
      }
      const timestamp = new Date();
      const uploadDate = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const uploadTime = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm:ss');

      // Updated row data: Removed the last element for QR Code Drive URL
      sheet.appendRow([timestamp, userName, fileName, fileType, source, driveUrl]); 
      Logger.log('File info logged to Google Sheet.');

      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        fileName: fileName,
        fileType: fileType,
        userName: userName,
        uploadDate: uploadDate,
        uploadTime: uploadTime,
        driveUrl: driveUrl,
        qrCode: qrCodeBase64Image, // Return the Base64 QR code directly
        source: source
      })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
      Logger.log('ERROR in doPost (action=uploadFile): ' + error.toString());
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: error.message || 'An unknown error occurred on the server during file upload.'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } else {
    const errorMessage = 'Invalid or missing action parameter. Action received: ' + (action || 'undefined/null') + '. Full parameters: ' + JSON.stringify(e.parameter);
    Logger.log('ERROR in doPost: ' + errorMessage);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: errorMessage
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  Logger.log('doGet received. This script is intended for POST requests.');
  return HtmlService.createHtmlOutputFromFile('index');
}

/**
 * ฟังก์ชันสร้าง QR Code และส่งข้อมูลกลับไปที่ Client โดยไม่บันทึก
 * @param {string} name - ชื่อของ QR Code ที่ผู้ใช้ตั้ง (เพื่อส่งกลับไปแสดงผล)
 * @param {string} link - URL หรือข้อมูลที่จะนำไปสร้างเป็น QR Code
 * @returns {object} อ็อบเจกต์ที่ประกอบด้วย base64Image และ qrName สำหรับแสดงผล
 */
function generateQRCodeBase64(name, link) {
  Logger.log(`Attempting to generate QR Code for link: ${link}`);
  if (!link) {
    Logger.log('Error: Link is missing for QR Code generation.');
    throw new Error('ไม่พบลิงก์สำหรับสร้าง QR Code');
  }

  try {
    // --- 1. สร้าง QR Code จาก API ---
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link)}`;
    Logger.log(`Fetching QR Code from API: ${qrApiUrl}`);
    const response = UrlFetchApp.fetch(qrApiUrl);
    const blob = response.getBlob();
    Logger.log(`QR Code API response received. Content type: ${blob.getContentType()}, Size: ${blob.getBytes().length} bytes`);

    // --- 2. แปลงรูปภาพเป็น Base64 เพื่อส่งกลับไปแสดงผล ---
    const base64Data = Utilities.base64Encode(blob.getBytes());
    const contentType = blob.getContentType();
    const base64Image = `data:${contentType};base64,${base64Data}`;
    Logger.log(`QR Code converted to Base64. Data URL length: ${base64Image.length}`);

    // --- 3. ส่งผลลัพธ์กลับไปที่ Client ---
    return {
      base64Image: base64Image,
      qrName: name // ส่งชื่อกลับไปด้วยเพื่อให้หน้าเว็บแสดงผลได้ถูกต้อง
    };

  } catch (e) {
    Logger.log(`ERROR in generateQRCodeBase64: ${e.toString()}`);
    throw new Error(`ไม่สามารถสร้าง QR Code ได้: ${e.message}`);
  }
}
