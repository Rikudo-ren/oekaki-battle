# おえかきバトル！

友だちと同じ部屋に集まり、順番に絵を描いて当てるオンラインゲームです。2〜8人で遊べます。ホストが1〜5周を選んで開始すると、描く順番がランダムに決まります。描く人だけにお題が表示され、ほかの人には文字数が表示されます。ひらがな（長音「ー」を含む）で最初に正解した人に1ポイント。正解後はホストが次のターンへ進めます。

## Firebase の準備

このアプリは Firebase Hosting、Authentication（匿名認証）、Realtime Database、Cloud Functions を使います。**Cloud Functions のデプロイには Blaze プラン（従量課金）への変更が必要です。** 利用量や料金は Firebase コンソールで確認し、予算アラートの設定をおすすめします。

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成（または既存プロジェクトを選択）します。
2. 「Authentication」→「Sign-in method」で **匿名** を有効にします。
3. 「Realtime Database」でデータベースを作成します。リージョンを選び、最初はロックモードで作成してください。後のデプロイでこのリポジトリのルールが適用されます。
4. プロジェクト設定の「マイアプリ」でウェブアプリを登録し、表示された Firebase 設定を `public/firebase-config.js` に記入します。Realtime Database の画面に表示される URL を `databaseURL` に指定してください（ウェブアプリの設定に含まれない場合があります）。これらはクライアント用の設定であり、アクセス制御はデータベースルールと Functions で行います。サービスアカウントの秘密鍵は入れないでください。
5. Firebase CLI をインストールしてログインし、プロジェクトを選択します。既存の `.firebaserc` は別プロジェクトを指している場合があるので、必ず自分のプロジェクト ID を指定してください。

```sh
npm install
npm run build
npm --prefix functions install
npx firebase-tools login
npx firebase-tools use --add
npx firebase-tools deploy --only database,functions,hosting
```

Cloud Functions は `asia-northeast1` にデプロイされます。匿名認証の承認済みドメインに、Hosting 以外の独自ドメインで公開する場合はそのドメインを追加してください。デプロイ後、Hosting の URL を友だちに共有してください。別の参加者は別のブラウザまたはプライベートウィンドウを使用してください（匿名認証の ID はブラウザ内で共有されます）。

## 開発・動作確認

Node.js 22 を使用してください。`npm run build` で `src/app.js` を `public/app.js` にバンドルします。ローカルの静的サーバーで見た目を確認できますが、オンライン機能には上記の Firebase 設定とデプロイ済み Functions・ルールが必要です。ローカルのドメインが認証の承認済みドメインに含まれているかも確認してください。

```sh
npm install
npm run build
npx serve public
```

## 運用上の注意

- お題の正解はサーバー側の `secrets` に保存し、ルールでクライアントからの読み取りを禁止しています。正解判定・得点の更新は Cloud Functions のトランザクションで行います。
- 待機中にホストが退出した場合は、残った参加者にホストが移ります。ゲーム中にホームへ戻っても参加情報は残り、同じブラウザで同じ合言葉から再参加できます。プレイ中の自動退出、タイムアウト、お題のスキップ、部屋や描画データの自動削除はありません。参加者が戻れなくなった場合は新しい部屋を作成してください。不要になったデータは Firebase コンソールで削除してください。
- 公開サービスとして運用する場合は、App Check、レート制限、データの定期削除などの追加対策を検討してください。
