import { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { open } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { Upload, Link, FileText, Loader2, X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import { copyFile, writeFile, preprocessFile, fetchAndExtractUrl } from "@/commands/fs"
import { enqueueIngest, enqueueBatch } from "@/lib/ingest-queue"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getFileName, normalizePath } from "@/lib/path-utils"

type Tab = "file" | "url" | "paste"

interface AddSourceDialogProps {
  onClose: () => void
  onImported: () => void
}

async function getUniqueDestPath(dir: string, fileName: string): Promise<string> {
  const { readFile } = await import("@/commands/fs")
  const basePath = `${dir}/${fileName}`
  try {
    await readFile(basePath)
  } catch {
    return basePath
  }
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const withDate = `${dir}/${nameWithoutExt}-${date}${ext}`
  try {
    await readFile(withDate)
  } catch {
    return withDate
  }
  for (let i = 2; i <= 99; i++) {
    const withCounter = `${dir}/${nameWithoutExt}-${date}-${i}${ext}`
    try {
      await readFile(withCounter)
    } catch {
      return withCounter
    }
  }
  return `${dir}/${nameWithoutExt}-${date}-${Date.now()}${ext}`
}

export function AddSourceDialog({ onClose, onImported }: AddSourceDialogProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)

  const [activeTab, setActiveTab] = useState<Tab>("file")
  const [urlValue, setUrlValue] = useState("")
  const [pasteTitle, setPasteTitle] = useState("")
  const [pasteContent, setPasteContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleFileImport() {
    if (!project) return
    const selected = await open({
      multiple: true,
      title: t("addSource.selectFiles", "Select Source Files"),
      filters: [
        {
          name: "Documents",
          extensions: [
            "md", "mdx", "txt", "rtf", "pdf",
            "html", "htm", "xml",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "odt", "ods", "odp", "epub",
          ],
        },
        { name: "Data", extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml"] },
        { name: "Code", extensions: ["py", "js", "ts", "jsx", "tsx", "rs", "go", "java", "c", "cpp", "rb", "php", "swift", "sql", "sh"] },
        { name: "All Files", extensions: ["*"] },
      ],
    })
    if (!selected || selected.length === 0) return

    setLoading(true)
    setError(null)
    const pp = normalizePath(project.path)
    const paths = Array.isArray(selected) ? selected : [selected]
    const importedPaths: string[] = []

    for (const sourcePath of paths) {
      const originalName = getFileName(sourcePath) || "unknown"
      const destPath = await getUniqueDestPath(`${pp}/raw/sources`, originalName)
      try {
        await copyFile(sourcePath, destPath)
        importedPaths.push(destPath)
        preprocessFile(destPath).catch(() => {})
      } catch (err) {
        console.error(`Failed to import ${originalName}:`, err)
      }
    }

    if (hasUsableLlm(llmConfig)) {
      for (const destPath of importedPaths) {
        enqueueIngest(project.id, destPath).catch(console.error)
      }
    }
    setLoading(false)
    setSuccess(true)
    onImported()
    setTimeout(onClose, 800)
  }

  async function handleFolderImport() {
    if (!project) return
    const selected = await open({ directory: true, title: t("addSource.selectFolder", "Select Folder") })
    if (!selected || typeof selected !== "string") return

    setLoading(true)
    setError(null)
    const pp = normalizePath(project.path)
    const folderName = getFileName(selected) || "imported"
    const destDir = `${pp}/raw/sources/${folderName}`

    try {
      const copiedFiles: string[] = await invoke("copy_directory", { source: selected, destination: destDir })
      for (const fp of copiedFiles) preprocessFile(fp).catch(() => {})

      if (hasUsableLlm(llmConfig)) {
        const tasks = copiedFiles
          .filter((fp) => {
            const ext = fp.split(".").pop()?.toLowerCase() ?? ""
            return ["md","mdx","txt","pdf","docx","pptx","xlsx","xls","csv","json","html","htm","rtf","xml","yaml","yml"].includes(ext)
          })
          .map((filePath) => {
            const normFilePath = normalizePath(filePath)
            const normDestDir = normalizePath(destDir)
            const relPath = normFilePath.replace(normDestDir + "/", "")
            const parts = relPath.split("/")
            parts.pop()
            const context = parts.length > 0 ? `${folderName} > ${parts.join(" > ")}` : folderName
            return { sourcePath: filePath, folderContext: context }
          })
        if (tasks.length > 0) await enqueueBatch(project.id, tasks)
      }
      setLoading(false)
      setSuccess(true)
      onImported()
      setTimeout(onClose, 800)
    } catch (err) {
      setError(String(err))
      setLoading(false)
    }
  }

  async function handleUrlImport() {
    if (!project || !urlValue.trim()) return
    setLoading(true)
    setError(null)

    try {
      const fetched = await fetchAndExtractUrl(urlValue.trim())
      const pp = normalizePath(project.path)

      // Derive a filename from the URL
      let fileName = fetched.title
        .slice(0, 60)
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "webpage"
      fileName = `${fileName}.md`

      const destPath = await getUniqueDestPath(`${pp}/raw/sources`, fileName)
      const fileContent = `# ${fetched.title}\n\nSource: ${fetched.url}\n\n---\n\n${fetched.markdown}`
      await writeFile(destPath, fileContent)
      preprocessFile(destPath).catch(() => {})

      if (hasUsableLlm(llmConfig)) {
        enqueueIngest(project.id, destPath).catch(console.error)
      }
      setLoading(false)
      setSuccess(true)
      onImported()
      setTimeout(onClose, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  async function handlePasteImport() {
    if (!project || !pasteContent.trim()) return
    setLoading(true)
    setError(null)

    try {
      const pp = normalizePath(project.path)
      const title = pasteTitle.trim() || "pasted-content"
      const fileName = title
        .slice(0, 60)
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "pasted-content"

      const destPath = await getUniqueDestPath(`${pp}/raw/sources`, `${fileName}.md`)
      const fileContent = pasteTitle.trim()
        ? `# ${pasteTitle.trim()}\n\n${pasteContent}`
        : pasteContent
      await writeFile(destPath, fileContent)
      preprocessFile(destPath).catch(() => {})

      if (hasUsableLlm(llmConfig)) {
        enqueueIngest(project.id, destPath).catch(console.error)
      }
      setLoading(false)
      setSuccess(true)
      onImported()
      setTimeout(onClose, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "file", label: t("addSource.tabFile", "File"), icon: <Upload className="w-3.5 h-3.5" /> },
    { id: "url", label: t("addSource.tabUrl", "URL"), icon: <Link className="w-3.5 h-3.5" /> },
    { id: "paste", label: t("addSource.tabPaste", "Paste"), icon: <FileText className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">{t("addSource.title", "Add Source")}</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setError(null) }}
              className={`flex items-center gap-1.5 flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-foreground border-b-2 border-primary -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-4 space-y-4">
          {activeTab === "file" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("addSource.fileHint", "Import one or more files into your source library.")}
              </p>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleFileImport} disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {t("addSource.selectFiles", "Select Files")}
                </Button>
                <Button variant="outline" className="flex-1" onClick={handleFolderImport} disabled={loading}>
                  {t("addSource.selectFolder", "Select Folder")}
                </Button>
              </div>
            </div>
          )}

          {activeTab === "url" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="url-input" className="text-sm">
                  {t("addSource.urlLabel", "Web Page URL")}
                </Label>
                <Input
                  id="url-input"
                  type="url"
                  placeholder="https://example.com/article"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleUrlImport() }}
                  disabled={loading}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("addSource.urlHint", "The page will be fetched and its text content saved as a Markdown source file.")}
              </p>
              <Button
                className="w-full"
                onClick={handleUrlImport}
                disabled={loading || !urlValue.trim()}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link className="mr-2 h-4 w-4" />}
                {t("addSource.fetchUrl", "Fetch & Import")}
              </Button>
            </div>
          )}

          {activeTab === "paste" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="paste-title" className="text-sm">
                  {t("addSource.pasteTitle", "Title (optional)")}
                </Label>
                <Input
                  id="paste-title"
                  placeholder={t("addSource.pasteTitlePlaceholder", "My pasted content")}
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paste-content" className="text-sm">
                  {t("addSource.pasteContent", "Content")}
                </Label>
                <textarea
                  id="paste-content"
                  ref={textareaRef}
                  className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none font-mono"
                  placeholder={t("addSource.pasteContentPlaceholder", "Paste your text here...")}
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  disabled={loading}
                />
              </div>
              <Button
                className="w-full"
                onClick={handlePasteImport}
                disabled={loading || !pasteContent.trim()}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                {t("addSource.savePaste", "Save as Source")}
              </Button>
            </div>
          )}

          {/* Error / Success feedback */}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
          )}
          {success && (
            <p className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/30 px-3 py-2 rounded-md">
              <Check className="h-4 w-4" />
              {t("addSource.imported", "Source imported and queued for ingest.")}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
