import unzipper, { Entry } from 'unzipper'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import logger from '@main/utils/logger'
import DownloadManager from '@main/downloadManager'
import detectSystemProxy from '@main/utils/proxy'
import WindowManager from '@main/windowManager'

interface DownloadHandle {
  handleDownloadUpdate: (task: DownloadTask) => void
  handleDownloadCompleted: (task: DownloadTask) => void
  handleDownloadInterrupted: () => void
}

interface UnzipHandle {
  handleUnzipUpdate: (percent: number) => void
  handleUnzipCompleted: () => void
  handleUnzipInterrupted: () => void
}

abstract class ComponentInstaller {
  public abstract install (): Promise<void>

  public abstract checkUpdate (): Promise<Update | false | undefined>
  protected abstract onStart (): void
  protected abstract onProgress (progress: number): void
  protected abstract onCompleted (): void
  protected abstract onException (): void

  protected unzipFile = (src: string, dist: string): void => {
    const files: Array<{
      filename: string
      uncompressedSize: number
      compressedSize: number
      extractedSize: number
    }> = []
    fs.createReadStream(src).pipe(unzipper.Extract({ path: dist }))
      .on('entry', (entry: Entry) => {
        const filename = path.join(dist, entry.path)
        const { type } = entry
        if (type === 'File') {
          files.push({
            filename,
            uncompressedSize: entry.extra.uncompressedSize,
            compressedSize: entry.extra.compressedSize,
            extractedSize: 0
          })
          const writeStream = fs.createWriteStream(filename)
          writeStream.on('ready', () => {
            entry.on('data', (data: Uint8Array) => {
              writeStream.write(data, () => {
                const file = files.find(f => f.filename === filename)
                if (file) {
                  file.extractedSize += data.length
                  const extractedSize = files.reduce((acc, cur) => acc + cur.extractedSize, 0)
                  const totalSize = files.reduce((acc, cur) => acc + cur.uncompressedSize, 0)
                  this.unzipHandle.handleUnzipUpdate(extractedSize / totalSize)
                }
              })
            })
              .on('end', () => {
                writeStream.close()
              })
              .on('error', error => {
                logger.error(error)
                writeStream.close()
              })
          })
        } else if (type === 'Directory') {
          if (!fs.existsSync(filename)) { fs.mkdirSync(filename) }
        }
        entry.autodrain()
      })
      .on('finish', () => {
        this.unzipHandle.handleUnzipCompleted()
      })
      .on('error', error => {
        this.unzipHandle.handleUnzipInterrupted()
        logger.error(error)
      })
  }

  protected getRelease = async () => {
    if (this.releaseTemp && Date.now() - this.releaseTemp.updated < 5 * 60 * 1000) {
      return this.releaseTemp.data
    }
    const proxyUrl = await detectSystemProxy(new WindowManager().getWindow())
    let proxy
    if (proxyUrl) {
      const { protocol, hostname, port, username, password } = new URL(proxyUrl)
      proxy = {
        host: hostname,
        port: Number(port),
        protocol,
        auth: {
          username,
          password
        }
      }
    }

    const url = 'https://api.github.com/repos/MaaAssistantArknights/MaaAssistantArknights/releases'
    const releaseResponse = await axios.get(url, {
      adapter: require('axios/lib/adapters/http.js'),
      proxy
    })
    this.releaseTemp = { data: releaseResponse.data[0], updated: Date.now() }
    return this.releaseTemp.data
  }

  protected releaseTemp: {data: any, updated: number} | null = null

  public abstract readonly downloadHandle: DownloadHandle
  public abstract readonly unzipHandle: UnzipHandle
  public abstract downloader_: DownloadManager | null
  protected abstract readonly componentType: ComponentType
}

export default ComponentInstaller
