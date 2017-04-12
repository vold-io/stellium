import * as fs from 'fs'
import * as glob from 'glob'
import * as path from 'path'
import * as multer from 'multer'
import * as mkdirp from 'mkdirp'
import * as express from 'express'
import * as imageSize from 'image-size'
import {Router} from "express"
import {MediaPath, Monolog, StoragePath} from '../../../@stellium-common'
import {MediaFileModel} from '../../../@stellium-database'
import {FileUsageCheck} from './file_usage_check'


export const FilesRouter: Router = express()


const TempPath = path.resolve(StoragePath, '.tmp')


const getFileExtension = (fileName) => {
    return fileName.split('/')[1]
}


const storage = multer.diskStorage({
    // Temporary destination for file uploads
    destination: (req, file, cb) => mkdirp(TempPath, err => cb(err, TempPath))
})


const upload = multer({storage: storage})


FilesRouter.get('/', (req, res) => {

    MediaFileModel.find({}, (err, files) => {

        if (err) {

            Monolog({
                message: 'MongoDB failed to index media collection',
                error: err
            })

            res.status(500).send('Internal Server Error')

        } else res.send(files)
    })
})


FilesRouter.get('/usage', FileUsageCheck)


/**
 *
 * Checks for existing file with the same file name. If a file with the same name exists, return null in callback
 * @param path
 * @param cb
 * @constructor
 */
const CheckForConflictingFile = (path: string, cb?: (err: any) => void): void => {

    fs.access(path, err => {

        if (err) {

            if (err.code === 'ENOENT') {
                cb(null)
                return
            }

            cb(err)
            Monolog({
                message: 'Unknown error when checking for conflicting file',
                error: err
            })
            return
        }
        // There is no error so a conflicting file exists, force error in callback
        cb(true)
    })
}


FilesRouter.post('/', upload.single('file'), (req, res) => {

    if (!req.file) {
        res.status(309).send('Missing file object in request')
        Monolog({
            message: 'The user somehow managed to POST to files without a File object'
        })
        return
    }

    // Current directory where user is uploading from
    let targetDir = req.body['current_dir'].replace(/^\/+|\/+$/g, '')

    // File name
    let file_name = req.body['filename']

    // File title defaults to file name if not title given
    let file_title = req.body['title'] || file_name

    // Path where the uploaded file is to be stored
    let newPath = path.resolve(MediaPath, targetDir, file_name)

    console.log('newPath', newPath)

    /**
     *
     * Check for conflicting files in the media directory
     */
    CheckForConflictingFile(newPath, err => {

        if (err) {
            /**
             * TODO(boris): Instead of returning an error, return file name automatically
             * @date - 17 Jan 2017
             * @time - 1:25 PM
             */
            res.status(309).send('A file with the same name already exists. Please change your file\'s name and try again.')
            return
        }

        fs.rename(req.file.path, newPath, err => {

            if (err) {
                Monolog({
                    message: 'Error renaming temp file to targeted directory',
                    error: err
                })
                res.status(500).send('Internal Server Error')
                return
            }

            let folderDest = newPath.replace(MediaPath, '').replace(file_name, '')

            const dimensions = imageSize(newPath)

            const containingFolder = folderDest === '/' ? '/' : folderDest.replace(/\/$/g, '')

            const fileMetadata = {
                url: newPath.replace(MediaPath, '').replace(/^\//, ''),
                title: file_title,
                folder: containingFolder,
                type: getFileExtension(req.file.mimetype),
                width: dimensions.width,
                height: dimensions.height,
                description: req.body['description'] || {en: file_title},
                trash_name: null,
                user_id: req.user._id,
                // set with fs.stat
                size: undefined,
            }

            fs.stat(newPath, (err, file) => {

                fileMetadata.size = file.size

                MediaFileModel.create(fileMetadata, err => {

                    if (err) {
                        Monolog({
                            message: 'Error saving file metadata while uploading a new file',
                            error: err
                        })
                        fs.unlinkSync(newPath)
                        res.status(500).send('Internal Server Error')
                        return
                    }

                    res.send({message: 'File saved successfully!'})
                })
            })
        })
    })
})


FilesRouter.get('/:fileId', (req, res) => {

    MediaFileModel.findById(req.params['fileId'], (err, file) => {

        if (err) {

            Monolog({
                message: 'Failed to retrieve file document',
                error: err
            })

            res.status(500).send('Internal Server Error')

        } else res.send(file)
    })
})


/**
 * Replaces a file with a new one
 *
 */
FilesRouter.patch('/:fileId', (req, res) => {
    res.send('Attempting to patch a file')
})


FilesRouter.delete('/:fileId', (req, res) => {

    MediaFileModel.findById(req.params['fileId'], (err, _file) => {

        if (err) return res.status(500).send('Error deleting file')

        fs.unlink(path.resolve(MediaPath, _file['url']), (err) => {

            if (err) {

                console.log('error removing file', err)

                return res.status(500).send('An error occurred while trying to delete the selected file.')
            }

            _file.remove((err) => {

                if (err) {

                    console.log('error removing file', err)

                    return res.status(500).send('An error occurred while trying to delete the file from the database')
                }

                res.send('File has been deleted successfully.')
            })
        })
    })
})


const clearTempFolder = () => {

    glob(TempPath + '/*', (err, files) => {

        files.forEach(file => {

            fs.unlink(file, err => {

                if (err) {

                    Monolog({
                        message: 'Error deleting file in `clearTempFolder()`',
                        error: err
                    })
                }
            })
        })
    })
}


const checkMultipleFiles = (files, cb) => {

    files.forEach(file => {

        // TODO(boris): wrong path, here is temp path but should check final path
        let fileExist = fs.statSync(file.path)

        if (fileExist) return cb(new Error('File exists'), false)
    })

    cb(null, true)
}
