// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below



import * as vscode from 'vscode';
import {PluginService, ExtensionInformation} from './pluginService';
import * as path from 'path';
import {Environment} from './environmentPath';
import {File, FileManager} from './fileManager';
import * as commons from './commons';
import {GithubService} from './githubService';
import {LocalSetting, CloudSetting, OldSetting} from './setting';
import {OsType, SettingType} from './enums';




// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

export async function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated

    //migration code

    var en: Environment = new Environment(context);
    var common: commons.Commons = new commons.Commons(en);
    var oldSyncSetting: any = await common.InitSettings();
    var newSetting: LocalSetting;
    newSetting = new LocalSetting();

    if (oldSyncSetting) {
        if (!oldSyncSetting.Version || oldSyncSetting.Version < Environment.CURRENT_VERSION) {
            newSetting.Version = Environment.CURRENT_VERSION;

            if (oldSyncSetting.Token) {
                newSetting.Token = oldSyncSetting.Token;
                if (oldSyncSetting.Gist) {
                    newSetting.Gist = oldSyncSetting.Gist;
                }
            }
            await common.SaveSettings(newSetting).then(async function (added: boolean) {
                if (added) {
                    vscode.window.showInformationMessage("Sync : Migration to new version complete. Read Release Notes for details.");
                }
                else {
                    vscode.window.showErrorMessage("GIST and Token couldn't be migrated to new version. You need to add them again.")
                }
            });
        }
        else {

            newSetting = oldSyncSetting;
            var tokenAvailable = newSetting.Token != null || newSetting.Token != "";
            var gistAvailable = newSetting.Gist != null || newSetting.Gist != "";

            if (tokenAvailable && gistAvailable && newSetting.autoSync) {
                vscode.commands.executeCommand('extension.downloadSettings');
            }
        }
    }

    var openurl = require('open');
    var fs = require('fs');
    var GitHubApi = require("github4");

    var github = new GitHubApi({
        version: "3.0.0"
    });

    var updateSettings = vscode.commands.registerCommand('extension.updateSettings', async () => {
        var en: Environment = new Environment(context);
        var common: commons.Commons = new commons.Commons(en);
        var myGi: GithubService = null;
        var dateNow: Date = new Date();

        vscode.window.setStatusBarMessage("Sync : Checking for Github Token and GIST.", 2000);
        var syncSetting: any = await common.InitSettings();

        async function Init() {

            if (syncSetting.Token == null || syncSetting.Token == "") {
                openurl("https://github.com/settings/tokens");
                await common.GetTokenAndSave(syncSetting).then(function (saved: boolean) {
                    if (saved) {
                        Init();
                        return;
                    }
                    else {
                        vscode.window.showErrorMessage("TOKEN NOT SAVED");
                        return;
                    }
                }, function (err: any) {
                    console.error(err);
                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                    return;
                });
            }
            else {
                myGi = new GithubService(syncSetting.Token);
                vscode.window.setStatusBarMessage("Sync : Uploading / Updating Your Settings In Github.", 3000);
                await startGitProcess();
                return;
            }
        }


        async function startGitProcess() {

            if (syncSetting.Token != null) {
                syncSetting.lastUpload = dateNow;

                var allSettingFiles = new Array<File>();
                vscode.window.setStatusBarMessage("Sync : Reading Settings and Extensions.", 1000);

                var settingFile: File = await FileManager.GetFile(en.FILE_SETTING, en.FILE_SETTING_NAME);
                var launchFile: File = await FileManager.GetFile(en.FILE_LAUNCH, en.FILE_SETTING_NAME);
                var keybindingFile: File = await FileManager.GetFile(en.FILE_KEYBINDING, en.FILE_SETTING_NAME);
                var localeFile: File = await FileManager.GetFile(en.FILE_LOCALE, en.FILE_SETTING_NAME);

                allSettingFiles.push(settingFile);
                allSettingFiles.push(launchFile);
                allSettingFiles.push(keybindingFile);
                allSettingFiles.push(localeFile);

                var destinationKeyBinding: string = "";
                if (en.OsType == OsType.Mac) {
                    destinationKeyBinding = en.FILE_KEYBINDING_MAC;
                }
                else {
                    destinationKeyBinding = en.FILE_KEYBINDING_DEFAULT;
                }

                var extensionlist = PluginService.CreateExtensionList();
                extensionlist.sort(function (a, b) {
                    return a.name.localeCompare(b.name);
                });

                var fileName = en.FILE_EXTENSION_NAME;
                var filePath = en.FILE_EXTENSION;
                var fileContent = JSON.stringify(extensionlist, undefined, 2);;
                var file: File = new File(fileName, fileContent, filePath);
                allSettingFiles.push(file);


                var snippetFiles = await FileManager.ListFiles(en.FOLDER_SNIPPETS);
                snippetFiles.forEach(snippetFile => {
                    allSettingFiles.push(snippetFile);
                });

                var extProp: CloudSetting = new CloudSetting();
                extProp.lastUpload = dateNow;

                fileName = en.FILE_CLOUDSETTINGS_NAME;
                fileContent = JSON.stringify(extProp);
                file = new File(fileName, fileContent, "");
                allSettingFiles.push(file);
                var newGIST = false;

                if (syncSetting.Gist == null || syncSetting.Gist === "") {

                    newGIST = true;
                    await myGi.CreateEmptyGIST().then(async function (gistID: string) {
                        if (gistID) {
                            syncSetting.Gist = gistID;
                        }
                    }, function (error: any) {
                        console.log(error);
                        vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                        return;
                    });
                }

                await myGi.ReadGist(syncSetting.Gist).then(async function (gistObj: any) {

                    vscode.window.setStatusBarMessage("Sync : Inserting Files Data.");
                    gistObj = myGi.UpdateGIST(gistObj, allSettingFiles);

                    await myGi.SaveGIST(gistObj).then(async function (saved: boolean) {
                        if (saved) {
                            await common.SaveSettings(syncSetting).then(function (added: boolean) {
                                if (added) {
                                    if (newGIST) {
                                        vscode.window.showInformationMessage("Uploaded Successfully." + " GIST ID :  " + syncSetting.Gist + " . Please copy and use this ID in other machines to sync all settings.");
                                    }
                                    vscode.window.setStatusBarMessage("Sync : Gist Saved.", 1000);
                                }
                            }, function (err: any) {
                                console.error(err);
                                vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                return;
                            });

                        }
                        else {

                        }
                    }, function (error: any) {
                        console.log(error);
                        vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                        return;
                    });
                }, function (gistReadError: any) {
                    console.log(gistReadError);
                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                    return;
                });
            }
            else {
                vscode.window.showErrorMessage("ERROR ! Github Account Token Not Set");
            }
        }

        await Init();

    });


    var downloadSettings = vscode.commands.registerCommand('extension.downloadSettings', async () => {

        var en: Environment = new Environment(context);
        var common: commons.Commons = new commons.Commons(en);
        var myGi: GithubService = null;

        vscode.window.setStatusBarMessage("Sync : Checking for Github Token and GIST.", 2000);
        var sett: any = await common.InitSettings();
        var syncSetting: LocalSetting = sett;

        async function Init() {

            if (syncSetting.Token == null || syncSetting.Token == "") {
                openurl("https://github.com/settings/tokens");
                await common.GetTokenAndSave(syncSetting).then(function (saved: boolean) {
                    if (saved) {
                        Init();
                        return;
                    }
                    else {
                        vscode.window.showErrorMessage("TOKEN NOT SAVED");
                        return;
                    }
                }, function (err: any) {
                    console.error(err);
                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                    return;
                });
            }
            myGi = new GithubService(syncSetting.Token);
            if (syncSetting.Gist == null || syncSetting.Gist == "") {
                await common.GetGistAndSave(syncSetting).then(function (saved: boolean) {
                    if (saved) {
                        Init();
                        return;
                    }
                    else {
                        vscode.window.showErrorMessage("GIST NOT SAVED");
                        return;
                    }
                }, function (err: any) {
                    console.error(err);
                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                    return;
                });
            }
            await StartDownload();

        }

        async function StartDownload() {

            myGi.ReadGist(syncSetting.Gist).then(async function (res: any) {
                var keys = Object.keys(res.files);
                if (keys.indexOf(en.FILE_CLOUDSETTINGS_NAME) > -1) {
                    var cloudSett: CloudSetting = JSON.parse(res.files[en.FILE_CLOUDSETTINGS_NAME].content);
                    var stat: boolean = (syncSetting.lastUpload == cloudSett.lastUpload) || (syncSetting.lastDownload == cloudSett.lastUpload);
                    if (stat) {
                        vscode.window.showInformationMessage("Sync : You already have latest version of saved settings.");
                        return;
                    }
                    syncSetting.lastDownload = cloudSett.lastUpload;
                }


                for (var i: number = 0; i < keys.length; i++) {
                    switch (keys[i]) {
                        case "launch.json": {
                            await FileManager.WriteFile(en.FILE_LAUNCH, res.files[en.FILE_LAUNCH_NAME].content).then(
                                function (added: boolean) {
                                    vscode.window.showInformationMessage("Launch Settings downloaded Successfully");
                                }, function (error: any) {
                                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                    return;
                                }
                            );
                            break;
                        }
                        case "settings.json": {
                            await FileManager.WriteFile(en.FILE_SETTING, res.files[en.FILE_SETTING_NAME].content).then(
                                function (added: boolean) {
                                    vscode.window.showInformationMessage("Editor Settings downloaded Successfully");
                                }, function (error: any) {
                                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                    return;
                                });
                            break;
                        }
                        case en.FILE_KEYBINDING_DEFAULT:
                        case en.FILE_KEYBINDING_MAC: {

                            var sourceKeyBinding: string = "";

                            if (en.OsType == OsType.Mac) {
                                sourceKeyBinding = en.FILE_KEYBINDING_MAC;
                            }
                            else {
                                sourceKeyBinding = en.FILE_KEYBINDING_DEFAULT;
                            }

                            await FileManager.WriteFile(en.FILE_KEYBINDING, res.files[sourceKeyBinding].content).then(
                                function (added: boolean) {
                                    if (en.OsType == OsType.Mac) {
                                        vscode.window.showInformationMessage("Keybinding Settings for Mac downloaded Successfully");
                                    } else {
                                        vscode.window.showInformationMessage("Keybinding Settings downloaded Successfully");
                                    }
                                }, function (error: any) {
                                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                    return;
                                });
                            break;
                        }
                        case "locale.json": {

                            await FileManager.WriteFile(en.FILE_LOCALE, res.files[en.FILE_LOCALE_NAME].content).then(
                                function (added: boolean) {
                                    vscode.window.showInformationMessage("Locale Settings downloaded Successfully");
                                }, function (error: any) {
                                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                    return;
                                });
                            break;
                        }
                        case "extensions.json": {

                            var extensionlist = PluginService.CreateExtensionList();
                            extensionlist.sort(function (a, b) {
                                return a.name.localeCompare(b.name);
                            });


                            var remoteList = ExtensionInformation.fromJSONList(res.files[en.FILE_EXTENSION_NAME].content);
                            var deletedList = PluginService.GetDeletedExtensions(remoteList);

                            for (var deletedItemIndex = 0; deletedItemIndex < deletedList.length; deletedItemIndex++) {
                                var deletedExtension = deletedList[deletedItemIndex];
                                await PluginService.DeleteExtension(deletedExtension, en.ExtensionFolder)
                                    .then((res) => {
                                        vscode.window.showInformationMessage(deletedExtension.name + '-' + deletedExtension.version + " is removed.");
                                    }, (rej) => {
                                        vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                    });
                            }

                            var missingList = PluginService.GetMissingExtensions(remoteList);
                            if (missingList.length == 0) {
                                vscode.window.showInformationMessage("No extension need to be installed");
                            }
                            else {
                                var actionList = new Array<Promise<void>>();
                                vscode.window.setStatusBarMessage("Sync : Installing Extensions in background.");
                                missingList.forEach(element => {
                                    actionList.push(PluginService.InstallExtension(element, en.ExtensionFolder)
                                        .then(function () {
                                            var name = element.publisher + '.' + element.name + '-' + element.version;
                                            vscode.window.showInformationMessage("Extension " + name + " installed Successfully");
                                        }));
                                });
                                Promise.all(actionList)
                                    .then(function () {
                                        vscode.window.setStatusBarMessage("Sync : Restart Required to use installed extensions.");
                                        vscode.window.showInformationMessage("Extension installed Successfully, please restart");
                                    })
                                    .catch(function (e) {
                                        console.log(e);
                                        vscode.window.setStatusBarMessage("Sync : Extensions Download Failed.", 3000);
                                        vscode.window.showErrorMessage("Extension download failed." + common.ERROR_MESSAGE)
                                    });
                            }
                            break;
                        }
                        default: {
                            if (i < keys.length) {
                                if (keys[i].indexOf(".") > -1) {
                                    await FileManager.CreateDirectory(en.FOLDER_SNIPPETS);
                                    var file = en.FOLDER_SNIPPETS.concat(keys[i]);//.concat(".json");
                                    var fileName = keys[i]//.concat(".json");
                                    await FileManager.WriteFile(file, res.files[keys[i]].content).then(
                                        function (added: boolean) {
                                            vscode.window.showInformationMessage(fileName + " snippet added successfully.");
                                        }, function (error: any) {
                                            vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                                            return;
                                        }
                                    );
                                }
                            }
                            break;
                        }
                    }
                }

                await common.SaveSettings(syncSetting).then(async function (added: boolean) {
                    if (added) {
                        vscode.window.showInformationMessage("Sync : Download Complete.");
                    }
                    else {
                        vscode.window.showErrorMessage("GIST and Token couldn't be migrated to new version. You need to add them again.")
                    }
                }, function (errSave: any) {

                    console.log(errSave);
                    vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                    return;
                });

            }, function (err: any) {
                console.log(err);
                vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                return;
            });
        }
        await Init();
    });

    var resetSettings = vscode.commands.registerCommand('extension.resetSettings', async () => {
        var en: Environment = new Environment(context);
        var fManager: FileManager;
        var common: commons.Commons = new commons.Commons(en);
        var syncSetting: LocalSetting = await common.InitSettings();

        vscode.window.setStatusBarMessage("Sync : Resetting Your Settings.", 2000);
        try {
            syncSetting.Token = null;
            syncSetting.Gist = null;
            syncSetting.lastDownload = null;
            syncSetting.lastUpload = null;

            await common.SaveSettings(syncSetting).then(function (added: boolean) {
                if (added) {
                    vscode.window.showInformationMessage("GIST ID and Github Token Cleared.");
                }
            }, function (err: any) {
                console.error(err);
                vscode.window.showErrorMessage(common.ERROR_MESSAGE);
                return;
            });

        }
        catch (err) {
            console.log(err);
            vscode.window.showErrorMessage("Unable to clear settings. Error Logged on console. Please open an issue.");
        }
    });
    var releaseNotes = vscode.commands.registerCommand('extension.releaseNotes', async () => {
        openurl("http://shanalikhan.github.io/2016/05/14/Visual-studio-code-sync-settings-release-notes.html");
    });

    var openSettings = vscode.commands.registerCommand('extension.openSettings', async () => {

        openurl("http://shanalikhan.github.io/2016/07/31/Visual-Studio-code-sync-setting-edit-manually.html");
        vscode.window.showInformationMessage("Use 'How To Configure' command to setup for first time. Link is opened in case you need help to edit JSON manually.");

        var en: Environment = new Environment(context);
        var fManager: FileManager;
        var common: commons.Commons = new commons.Commons(en);
        var syncSetting: any = await common.InitSettings();


        var setting: vscode.Uri = vscode.Uri.file(en.APP_SETTINGS);
        vscode.workspace.openTextDocument(setting).then((a: vscode.TextDocument) => {
            vscode.window.showTextDocument(a, 1, false);
        });


    });

    var howSettings = vscode.commands.registerCommand('extension.HowSettings', async () => {
        openurl("http://shanalikhan.github.io/2015/12/15/Visual-Studio-Code-Sync-Settings.html");
    });

    var openIssue = vscode.commands.registerCommand('extension.OpenIssue', async () => {
        openurl("https://github.com/shanalikhan/code-settings-sync/issues/new");

    });

    var autoSync = vscode.commands.registerCommand('extension.autoSync', async () => {
        var en: Environment = new Environment(context);
        var common: commons.Commons = new commons.Commons(en);
        var setting: LocalSetting = await common.InitSettings();

        if(!setting){
            vscode.commands.executeCommand('extension.HowSettings');
            return;
        }
        var tokenAvailable = newSetting.Token != null || newSetting.Token != "";
        var gistAvailable = newSetting.Gist != null || newSetting.Gist != "";

        if (!tokenAvailable || !gistAvailable) {
            vscode.commands.executeCommand('extension.HowSettings');
            return;
        }
        if (setting.autoSync) {
            setting.autoSync = false;
        }
        else {
            setting.autoSync = true;
        }
        await common.SaveSettings(setting).then(async function (added: boolean) {
            if (added) {
                if (setting.autoSync) {
                    vscode.window.showInformationMessage("Sync : Auto Download turned ON upon VSCode Startup.");
                }
                else {
                    vscode.window.showInformationMessage("Sync : Auto Download turned OFF upon VSCode Startup.");
                }
            }
            else {
                vscode.window.showErrorMessage("Unable to set the autosync.");
            }
        }, function (err: any) {
            console.log(err);
            vscode.window.showErrorMessage("Unable to toggle auto sync. Please open an issue.");
        });

    });

    context.subscriptions.push(updateSettings);
    context.subscriptions.push(downloadSettings);
    context.subscriptions.push(resetSettings);
    context.subscriptions.push(releaseNotes);
    context.subscriptions.push(openSettings);
    context.subscriptions.push(howSettings);
    context.subscriptions.push(openIssue);
    context.subscriptions.push(autoSync);

}
