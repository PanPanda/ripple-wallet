import { Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable } from 'rxjs/Rx';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/distinctUntilChanged';
import 'rxjs/add/operator/filter';
import { Router } from '@angular/router';
import {RippleService} from '../ripple.service';
import { GlobalVariable, Tipinfo} from '../global-variable';

@Component({
    selector: 'app-withdraw',
    templateUrl: './withdraw.component.html',
    styleUrls: ['./withdraw.component.css']
})
export class WithdrawComponent implements OnInit {
    timer;
    ngOnDestroy() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        console.log("WithdrawComponent ngOnDestroy");
    }
    showloading:boolean = false;
    loading:string;
    tipinfo: Tipinfo = new Tipinfo();
    tipinfo_withdraw: Tipinfo = new Tipinfo();
    tipinfo_path: string;
    recipient_label: string;
    federation_json;
    extra_fields: Array<any> = [];
    Amount: any = {
        currency: "XRP",
        value: 0
    };
    withdraw_value: Number;
    amount_value: Number;
    destination_address: string;

    gateway: string;
    destination: string;
    domain: string;
    pathfind: any;
    paths = [];
    payment: any;
    isShowPaths: boolean = false;

    destination_tag: string;
    invoice_id: string;
    recipientInput = new FormControl();
    constructor(private ripple: RippleService, public gv: GlobalVariable, private router: Router) { }

    ngOnInit() {
        this.recipientInput.valueChanges
            .filter(recipient => {
                return this.valideRecipient(recipient);
            })
            .debounceTime(900)
            //.distinctUntilChanged()
            //.switchMap()
            .subscribe(recipient => {
                console.log(recipient);
                this.federation();
            })
    }
    valideRecipient(recipient): boolean {
        this.extra_fields = [];
        this.gateway = "";
        this.federation_json = "";
        this.paths = [];
        this.isShowPaths = false;
        this.showloading = false;
        if (!recipient || recipient.lastIndexOf("@") == -1 || recipient.lastIndexOf(".com") == -1) return false;
        this.destination = this.recipient_label.substring(0, this.recipient_label.indexOf("@"));
        this.domain = this.recipient_label.substring(this.recipient_label.indexOf("@") + 1);
        if (!this.destination || !this.domain) return false;
        let gateway_name = "";

        if (this.domain.indexOf("ripplefox") > -1) {
            gateway_name = "ripplefox";
        } else if (this.domain.indexOf("ripplechina") > -1) {
            gateway_name = "ripplechina";
        }
        if (!gateway_name) {
            console.log("提现地址错误");
            return false;
        }
        console.log(this.destination, gateway_name);

        this.gateway = this.ripple.gateways[gateway_name];
        if (!this.gateway) {
            console.log("不支持此网关");
            return false;
        }
        return true;
    }
    resolveRecipient() {
        console.log(this.recipient_label);
        if (this.extra_fields.length > 0) return;
        if (!this.valideRecipient(this.recipient_label)) return;
        this.federation();
    }
    federation() {
        let data = {
            destination: this.destination,
            domain: this.domain
        };
        this.showloading = true;
        this.loading = `连接网关${this.domain},获取提现参数信息`;
        this.ripple.bridge(this.gateway, "federation", data).subscribe(result => {
            console.log(result);
            this.showloading = false;
            this.loading = "";
            if (result.federation_json) {
                this.federation_json = result.federation_json;
                this.extra_fields = this.federation_json.extra_fields;
                this.Amount.currency = this.federation_json.currencies[0].currency;
                this.destination_address = this.federation_json.currencies[0].issuer;
                console.log(this.federation_json);
            } else {
                this.extra_fields = [];
                console.log("提现地址错误");
            }
        })
    }
    setWithdrawValue(value) {
        if (value && value > 0) {
            console.log("提现数量：", value);
            for (let i in this.extra_fields) {
                if (!this.extra_fields[i].value || this.extra_fields[i].value.replace(/ /g, '') == "") {
                    this.tipinfo.showWarning(`忘记填入：${this.extra_fields[i].label} `, 10);
                    return;
                }
            }
            this.getQuote();
        } else {
            this.tipinfo.showInfo("请输入发送数量", 10);
        }
    }
    withDraw(path) {
        clearInterval(this.timer);
        this.payment = path;
        this.payment.destination.tag = this.destination_tag;
        this.payment.invoiceID = this.invoice_id;
        this.sendPayment(this.payment);
    }
    getQuote() {
        console.log(this.extra_fields);
        let data = {
            destination: this.destination,
            domain: this.domain,
            amount: `${this.withdraw_value}/${this.Amount.currency}`,
            address: this.gv.wallet.address
        };
        for (let i in this.extra_fields) {
            data[this.extra_fields[i].name] = this.extra_fields[i].value;
        }
        this.showloading = true;
        this.loading = `连接网关${this.domain},获取提现手续费等信息`;
        this.ripple.bridge(this.gateway, "quote", data).subscribe(result => {
            console.log(result);
            this.showloading = false;
            this.loading = "";
            if (result.quote) {
                let quote = result.quote;
                let send = quote.send[0];
                console.log("send", send);
                this.destination_address = quote.destination_address;
                this.destination_tag = quote.destination_tag;
                this.invoice_id = quote.invoice_id.toUpperCase();
                this.Amount.currency = send.currency;
                this.Amount.counterparty = send.issuer;//这个地址不是发行者，是接受者，也是可以的
                this.Amount.value = send.value;
                this.pathfind = {
                    "source": {
                        "address": this.gv.wallet.address
                    },
                    "destination": {
                        "address": this.destination_address,
                        "amount": this.Amount
                    }
                };
                this.tipinfo.showInfo(` 提现额度：${this.withdraw_value}${this.Amount.currency}，需要发送:${this.Amount.value}${this.Amount.currency} 到接收方：“${this.recipient_label}(${this.destination_address})” `);
                if (!this.timer) this.timer = setInterval(() => { this.findPaths(); }, 10000);
                this.findPaths();
            } else {
                this.tipinfo.showWarning(`${result.errCode},${result.msg}|${result.error},${result.error_message}`, 12);
            }
        })
    }
    findPaths() {
        console.log("find paths", this.pathfind);
        this.showloading = true;
        this.loading = "计算需要向网关发送的提现资产数量和支付路径等信息";
        this.ripple.getPaths(this.pathfind).subscribe(result => {
            console.log(result);
            this.showloading = false;
            this.loading = "";
            if (result.ok) {
                this.paths = result.data;
                console.log("paths", this.paths);
                this.isShowPaths = true;
                this.tipinfo_path = `点击上面按钮，将发送按钮上标注的资产，接收方：${this.destination_address} 收到：${this.Amount.value}${this.Amount.currency}`;
            } else {
                this.paths = [];
                this.isShowPaths = false;
                this.tipinfo_path = "";
            }
        })
    }
    sendPayment(payment) {
        console.log("payment:", payment);
        this.tipinfo_withdraw.hide();
        this.showloading = true;
        this.loading = `正在向网关地址：${this.destination_address} 支付：${this.Amount.value}${this.Amount.currency} `;;
        this.ripple.sendPayment(payment).subscribe(result => {
            this.showloading = false;
            this.loading = "";
            console.log(result);
            if (result.ok) {
                this.isShowPaths = false;
                this.tipinfo_withdraw.showInfo("提现申请已经成功提交！");
            } else {
                this.tipinfo_withdraw.showWarning("遇到错误，提现操作失败！" + JSON.stringify(result.data));
            }

        })
    }
}
