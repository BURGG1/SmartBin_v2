
const cloudinary = require("cloudinary").v2;
const multer = require("multer");

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Custom Multer storage engine using Cloudinary SDK 2.x
class CloudinaryStorage {
    _handleFile(req, file, callback) {
        let completed = false;

        const finish = (err, result) => {
            if (completed) return;
            completed = true;
            callback(err, result);
        };

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "smartbin",
                allowed_formats: ["jpg", "jpeg", "png", "webp", "gif"],
                transformation: [{ width: 800, quality: "auto" }],
                resource_type: "image",
            },
            (error, result) => {
                if (error) return finish(error);

                finish(null, {
                    path: result.secure_url,
                    filename: result.public_id,
                    public_id: result.public_id,
                    size: result.bytes,
                    format: result.format,
                    width: result.width,
                    height: result.height,
                });
            }
        );

        file.stream.once("error", (error) => {
            uploadStream.destroy(error);
            finish(error);
        });

        uploadStream.once("error", finish);

        file.stream.pipe(uploadStream);
    }

    _removeFile(req, file, callback) {
        if (!file.filename) return callback(null);

        cloudinary.uploader
            .destroy(file.filename, { resource_type: "image" })
            .then(() => callback(null))
            .catch(callback);
    }
}

const storage = new CloudinaryStorage();

const imageFileFilter = (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
        return cb(null, true);
    }

    cb(new Error("Only image uploads are allowed."));
};

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
});

const uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter,
});

module.exports = { upload, uploadMemory, cloudinary };
