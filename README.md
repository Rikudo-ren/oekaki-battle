# おえかきバトル！

友だちと同じ部屋に集まり、順番に絵を描いて当てるオンラインゲームです。2〜8人で遊べます。ホストが1〜5周を選んで開始すると、描く順番がランダムに決まります。描く人だけにお題が表示され、ほかの人には文字数が表示されます。ひらがな（長音「ー」を含む）で最初に正解した人に1ポイント。正解後はホストが次のターンへ進めます。

## 公開構成と料金

画面の公開には **Vercel**、匿名認証とリアルタイムデータの保存・同期には **Firebase Authentication / Realtime Database** を使います。Firebase Hosting や Cloud Functions は使いません。Vercel Hobby と Firebase Spark の無料プランで始められますが、どちらも利用条件・無料枠に制限があり、無制限ではありません。利用状況や最新の条件は各サービスのコンソールで確認してください。

## 1. Firebase を準備する

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成（または既存プロジェクトを選択）し、料金プランが Spark であることを確認します。
2. 「Authentication」→「Sign-in method」で **匿名** を有効にします。
3. 「Realtime Database」でデータベースを作成します。リージョンを選び、最初はロックモードで作成してください。次のコマンドでこのリポジトリのルールを適用します。既存の `.firebaserc` は別プロジェクトを指している場合があるので、必ず `--project` に自分のプロジェクト ID を指定してください。

```sh
npx firebase-tools login
npx firebase-tools deploy --only database --project あなたのFirebaseプロジェクトID
```

4. プロジェクト設定の「マイアプリ」でウェブアプリを登録し、表示される Firebase 設定を控えます。Realtime Database の URL はデータベース画面でも確認できます（ウェブアプリの設定に含まれない場合があります）。

## 2. Vercel に公開する

1. [Vercel](https://vercel.com/) でこの GitHub リポジトリをインポートします。リポジトリの `vercel.json` にビルド設定があるため、Framework Preset は Other のままで大丈夫です。
2. デプロイ前に Vercel の Environment Variables に以下を設定します。各値は Firebase コンソールのウェブアプリ設定から取得し、`FIREBASE_DATABASE_URL` には手順1で作成した Realtime Database の URL を入れてください。本番とプレビューの両方で遊ぶ場合は **Production と Preview** の両方に設定します。

| Vercel の環境変数 | Firebase の値 |
| --- | --- |
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_DATABASE_URL` | `databaseURL` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_APP_ID` | `appId` |

3. デプロイします。Vercel で環境変数が不足しているとビルドは失敗します。後から環境変数を変更した場合は再デプロイしてください。
4. Firebase Authentication の「Settings」→「Authorized domains」に、公開された Vercel のドメイン（例: `example.vercel.app`、スキームやパスは不要）を追加します。プレビュー URL を使う場合も、そのホスト名を追加してください。
5. Vercel の URL を友だちに共有します。別の参加者は別のブラウザまたはプライベートウィンドウを使用してください（匿名認証の ID はブラウザ内で共有されます）。

Firebase のウェブアプリ設定はブラウザに配信される**公開情報**であり、Vercel の環境変数に入れても秘密にはなりません。アクセス制御には Realtime Database のルールを使います。サービスアカウントの秘密鍵は設定しないでください。

## 開発・動作確認

Node.js 22 を使用してください。`npm run build` で環境変数から `public/firebase-config.js` を生成し、`src/app.js` を `public/app.js` にバンドルします。生成された設定ファイルは Git に含めません。ローカルでは5つの環境変数がすべて未設定なら画面の確認用に空の設定を生成しますが、オンライン対戦はできません。一部だけ指定した場合はエラーになります。

```sh
npm install
# 対戦を試す場合は上記の5つの環境変数をシェルで設定してから実行
npm run build
npm test
npx serve public
```

ローカルでもオンライン機能には Firebase の設定とデプロイ済みデータベースルールが必要です。ローカルのドメインが Authentication の承認済みドメインに含まれているかも確認してください。

## 仕組みと運用上の注意

- お題は Realtime Database の `secrets` に保存し、現在描いている人以外が直接読み取れないようルールで制限します。正解の書き込みはルールが判定し、トランザクションで最初の1人だけを記録します。得点は正解記録から集計します。
- 専用のゲームサーバーを使わない友だち同士のカジュアルなゲーム向けです。ホストのブラウザがお題を生成しゲーム進行を管理するため、ホストは開発者ツールなどでお題や進行を操作でき、厳密な不正防止はできません。また、認証済みユーザーは合言葉を知っていれば部屋情報を読み取れます。公開サービスには追加の対策が必要です。8人制限は参加時の画面側の確認で、同時参加時には超過する可能性があります。
- 待機中にホストが退出した場合は、残った参加者にホストが移ります。ゲーム中にホームへ戻っても参加情報は残り、同じブラウザで同じ合言葉から再参加できます。プレイ中の自動退出、タイムアウト、お題のスキップ、部屋や描画データの自動削除はありません。ホストが準備中に通信を失うなど進行不能になった場合は新しい部屋を作成してください。不要なデータは Firebase コンソールで削除してください。
- 以前の Cloud Functions 版や Firebase Hosting をすでにデプロイした場合、今回の変更では既存サービスは自動削除されません。必要に応じて Firebase コンソールで確認してください。
