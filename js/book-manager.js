/**
 * BookManager - 蔵書の CRUD 管理を担当するクラス
 * kindle.json からのインポート、手動追加、削除機能を提供
 */
class BookManager {
    constructor() {
        this.library = {
            books: [],
            metadata: {
                lastImportDate: null,
                totalBooks: 0,
                manuallyAdded: 0,
                importedFromKindle: 0
            }
        };
    }

    /**
     * ライブラリデータを初期化・読み込み
     */
    async initialize() {
        // まずLocalStorageから確認
        const savedLibrary = localStorage.getItem('virtualBookshelf_library');
        if (savedLibrary) {
            try {
                this.library = JSON.parse(savedLibrary);
                // Data restored from localStorage
                return;
            } catch (error) {
                // LocalStorage loading error (fallback to file)
            }
        }
        
        // LocalStorageにない場合はlibrary.jsonを確認
        try {
            const response = await fetch('data/library.json');
            const libraryData = await response.json();
            // 新しいデータ構造から古い形式に変換
            this.library = {
                books: Object.values(libraryData.books).map(book => ({
                    title: book.title,
                    authors: book.authors,
                    acquiredTime: book.acquiredTime,
                    readStatus: book.readStatus,
                    asin: Object.keys(libraryData.books).find(asin => libraryData.books[asin] === book),
                    productImage: book.productImage,
                    source: book.source,
                    addedDate: book.addedDate
                })),
                metadata: {
                    totalBooks: libraryData.stats.totalBooks,
                    manuallyAdded: 0,
                    importedFromKindle: libraryData.stats.totalBooks,
                    lastImportDate: libraryData.exportDate
                }
            };
            // Data loaded from library.json
        } catch (error) {
            // ファイルが存在しない場合は空の蔵書で初期化（自動インポートしない）
            // Initializing empty library (no library.json found)
            this.library = {
                books: [],
                metadata: {
                    totalBooks: 0,
                    manuallyAdded: 0,
                    importedFromKindle: 0,
                    lastImportDate: null
                }
            };
        }
    }

    /**
     * kindle.jsonから初回データを移行
     */
    async initializeFromKindleData() {
        try {
            const response = await fetch('data/kindle.json');
            const kindleBooks = await response.json();
            
            this.library.books = kindleBooks.map(book => ({
                ...book,
                source: 'kindle_import',
                addedDate: Date.now()
            }));
            
            this.library.metadata = {
                lastImportDate: Date.now(),
                totalBooks: kindleBooks.length,
                manuallyAdded: 0,
                importedFromKindle: kindleBooks.length
            };
            
            await this.saveLibrary();
            // Kindle import completed
        } catch (error) {
            // Kindle.json loading error
        }
    }

    /**
     * kindle.jsonから新しいデータをインポート（重複チェック付き）
     */
    async importFromKindle(fileInput = null) {
        let kindleBooks;
        
        if (fileInput) {
            // ファイル入力からインポート
            const fileContent = await this.readFileContent(fileInput);
            kindleBooks = JSON.parse(fileContent);
        } else {
            // data/kindle.json からインポート
            const response = await fetch('data/kindle.json');
            kindleBooks = await response.json();
        }

        const importResults = {
            total: kindleBooks.length,
            added: 0,
            updated: 0,
            skipped: 0
        };

        for (const kindleBook of kindleBooks) {
            const existingBook = this.library.books.find(book => book.asin === kindleBook.asin);
            
            if (existingBook) {
                // 既存書籍の更新（新しい情報で上書き）
                if (this.shouldUpdateBook(existingBook, kindleBook)) {
                    Object.assign(existingBook, {
                        title: kindleBook.title,
                        authors: kindleBook.authors,
                        acquiredTime: kindleBook.acquiredTime,
                        readStatus: kindleBook.readStatus,
                        productImage: kindleBook.productImage
                    });
                    importResults.updated++;
                }
                else {
                    importResults.skipped++;
                }
            } else {
                // 新規書籍の追加
                this.library.books.push({
                    ...kindleBook,
                    source: 'kindle_import',
                    addedDate: Date.now()
                });
                importResults.added++;
            }
        }

        // メタデータ更新
        this.library.metadata.lastImportDate = Date.now();
        this.library.metadata.totalBooks = this.library.books.length;
        this.library.metadata.importedFromKindle = this.library.books.filter(book => book.source === 'kindle_import').length;

        await this.saveLibrary();
        
        console.log('インポート結果:', importResults);
        return importResults;
    }

    async importSelectedBooks(selectedBooks) {
        const importedBooks = [];
        const duplicateBooks = [];
        const errorBooks = [];
        
        // 既存の本のASINを取得
        const existingASINs = new Set(this.library.books.map(book => book.asin));
        
        for (const book of selectedBooks) {
            try {
                // 重複チェック
                if (existingASINs.has(book.asin)) {
                    duplicateBooks.push({
                        title: book.title,
                        asin: book.asin,
                        reason: '既に存在'
                    });
                    continue;
                }
                
                // 本を追加
                const bookToAdd = {
                    ...book,
                    source: 'kindle_import',
                    addedDate: Date.now()
                };
                
                this.library.books.push(bookToAdd);
                importedBooks.push(bookToAdd);
                
            } catch (error) {
                console.error(`本の処理エラー: ${book.title}`, error);
                errorBooks.push({
                    title: book.title,
                    asin: book.asin,
                    reason: error.message
                });
            }
        }
        
        // メタデータを更新
        this.library.metadata = {
            totalBooks: this.library.books.length,
            manuallyAdded: this.library.books.filter(b => b.source === 'manual_add').length,
            importedFromKindle: this.library.books.filter(b => b.source === 'kindle_import').length,
            lastImportDate: Date.now()
        };
        
        // ライブラリを保存
        await this.saveLibrary();
        
        console.log(`選択インポート完了: ${importedBooks.length}件追加`);
        
        return {
            success: true,
            total: selectedBooks.length,
            added: importedBooks.length,
            updated: 0, // 選択インポートでは更新なし
            skipped: duplicateBooks.length + errorBooks.length,
            imported: importedBooks,
            duplicates: duplicateBooks,
            errors: errorBooks
        };
    }

    async updateBook(asin, updates) {
        const bookIndex = this.library.books.findIndex(book => book.asin === asin);
        
        if (bookIndex === -1) {
            throw new Error('指定された本が見つかりません');
        }
        
        // 本の情報を更新
        const book = this.library.books[bookIndex];
        Object.assign(book, updates);
        
        // メタデータを更新
        this.library.metadata.totalBooks = this.library.books.length;
        this.library.metadata.manuallyAdded = this.library.books.filter(b => b.source === 'manual_add').length;
        this.library.metadata.importedFromKindle = this.library.books.filter(b => b.source === 'kindle_import').length;
        
        // ライブラリを保存
        await this.saveLibrary();
        
        console.log(`本を更新: ${book.title}`);
        return true;
    }

    /**
     * 書籍更新が必要かチェック
     */
    shouldUpdateBook(existingBook, newBook) {
        return existingBook.acquiredTime !== newBook.acquiredTime ||
               existingBook.readStatus !== newBook.readStatus ||
               existingBook.title !== newBook.title ||
               existingBook.productImage !== newBook.productImage;
    }

    /**
     * AmazonリンクからASINを抽出
     */
    extractASINFromUrl(url) {
        const patterns = [
            /amazon\.co\.jp\/dp\/([A-Z0-9]{10})/,
            /amazon\.co\.jp\/.*\/dp\/([A-Z0-9]{10})/,
            /amazon\.com\/dp\/([A-Z0-9]{10})/,
            /amazon\.com\/.*\/dp\/([A-Z0-9]{10})/,
            /\/([A-Z0-9]{10})(?:\/|\?|$)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    /**
     * Amazon Product Advertising API風のデータ取得（簡易版）
     */
    async fetchBookDataFromAmazon(asin) {
        // 実際の実装では Amazon Product Advertising API を使用
        // 現在は簡易的な実装
        return {
            asin: asin,
            title: 'タイトル未取得',
            authors: '著者未取得',
            acquiredTime: Date.now(),
            readStatus: 'UNKNOWN',
            productImage: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`
        };
    }

    /**
     * 手動で書籍を追加
     */
    async addBookManually(bookData) {
        const asin = bookData.asin;
        
        if (!asin || !this.isValidASIN(asin)) {
            throw new Error('有効なASINが必要です');
        }

        // 重複チェック
        if (this.library.books.find(book => book.asin === asin)) {
            throw new Error('この本は既に蔵書に追加されています');
        }

        const newBook = {
            asin: asin,
            title: bookData.title || 'タイトル未設定',
            authors: bookData.authors || '著者未設定',
            acquiredTime: bookData.acquiredTime || Date.now(),
            readStatus: bookData.readStatus || 'UNKNOWN',
            productImage: bookData.productImage || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`,
            source: 'manual_add',
            addedDate: Date.now()
        };

        this.library.books.push(newBook);
        this.library.metadata.totalBooks = this.library.books.length;
        this.library.metadata.manuallyAdded = this.library.books.filter(book => book.source === 'manual_add').length;

        await this.saveLibrary();
        return newBook;
    }

    /**
     * Amazonリンクから書籍を追加
     */
    async addBookFromAmazonUrl(url) {
        const asin = this.extractASINFromUrl(url);
        if (!asin) {
            throw new Error('有効なAmazonリンクではありません');
        }

        // Amazon APIから書籍情報を取得（簡易版）
        const bookData = await this.fetchBookDataFromAmazon(asin);
        return await this.addBookManually(bookData);
    }

    /**
     * 書籍を削除
     */
    async deleteBook(asin, hardDelete = false) {
        const bookIndex = this.library.books.findIndex(book => book.asin === asin);
        
        if (bookIndex === -1) {
            throw new Error('指定された書籍が見つかりません');
        }

        if (hardDelete) {
            // 完全削除
            this.library.books.splice(bookIndex, 1);
            this.library.metadata.totalBooks = this.library.books.length;
            
            // ソース別カウント更新
            this.library.metadata.manuallyAdded = this.library.books.filter(book => book.source === 'manual_add').length;
            this.library.metadata.importedFromKindle = this.library.books.filter(book => book.source === 'kindle_import').length;
        }

        await this.saveLibrary();
        return true;
    }

    /**
     * 蔵書を全てクリア
     */
    async clearAllBooks() {
        this.library.books = [];
        this.library.metadata = {
            totalBooks: 0,
            manuallyAdded: 0,
            importedFromKindle: 0,
            lastImportDate: null
        };
        
        await this.saveLibrary();
        return true;
    }

    /**
     * 書籍情報を更新
     */
    async updateBook(asin, updates) {
        const book = this.library.books.find(book => book.asin === asin);
        if (!book) {
            throw new Error('指定された書籍が見つかりません');
        }

        Object.assign(book, updates);
        await this.saveLibrary();
        return book;
    }

    /**
     * ASINの妥当性チェック
     */
    isValidASIN(asin) {
        return /^[A-Z0-9]{10}$/.test(asin);
    }

    /**
     * ファイル内容を読み取り
     */
    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * ライブラリデータをファイルに保存（エクスポート用）
     */
    async saveLibrary() {
        // LocalStorage に保存
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.library));
        
        // ダウンロード可能な形でエクスポート
        return this.library;
    }

    /**
     * ライブラリデータをJSONファイルとしてダウンロード
     */
    exportLibraryData() {
        const dataStr = JSON.stringify(this.library, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'library.json';
        link.click();
        
        URL.revokeObjectURL(link.href);
    }

    /**
     * 統計情報を取得
     */
    getStatistics() {
        const books = this.library.books;
        return {
            total: books.length,
            read: books.filter(book => book.readStatus === 'READ').length,
            unread: books.filter(book => book.readStatus === 'UNKNOWN').length,
            manuallyAdded: books.filter(book => book.source === 'manual_add').length,
            importedFromKindle: books.filter(book => book.source === 'kindle_import').length,
            lastImportDate: this.library.metadata.lastImportDate
        };
    }

    /**
     * 全ての書籍を取得
     */
    getAllBooks() {
        return this.library.books;
    }

    /**
     * ASIN で書籍を検索
     */
    findBookByASIN(asin) {
        return this.library.books.find(book => book.asin === asin);
    }

    /**
     * タイトルまたは著者で書籍を検索
     */
    searchBooks(query) {
        const lowercaseQuery = query.toLowerCase();
        return this.library.books.filter(book => 
            book.title.toLowerCase().includes(lowercaseQuery) ||
            book.authors.toLowerCase().includes(lowercaseQuery)
        );
    }
}

// BookManager の自動エクスポート処理（定期保存）
class AutoSaveManager {
    constructor(bookManager) {
        this.bookManager = bookManager;
        this.setupAutoSave();
    }

    setupAutoSave() {
        // 5分ごとに自動保存
        setInterval(() => {
            this.bookManager.saveLibrary();
        }, 5 * 60 * 1000);

        // ページ離脱時の保存
        window.addEventListener('beforeunload', () => {
            this.bookManager.saveLibrary();
        });
    }
}